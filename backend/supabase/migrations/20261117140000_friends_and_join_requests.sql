-- Friends, then pacts made from friends. You add someone by their email, they accept, and from then on
-- you can ask them into a pact. They join when they say yes. This replaces sharing invite codes in the app.
-- Both tables are read through the functions below; nobody writes to them directly.

create table public.friend_requests (
    request_id uuid primary key default gen_random_uuid(),
    from_user uuid not null references auth.users(id) on delete cascade,
    to_user uuid not null references auth.users(id) on delete cascade,
    status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
    created_at timestamptz not null default now(),
    responded_at timestamptz,
    check (from_user <> to_user),
    unique (from_user, to_user)
);

create index friend_requests_to_user_idx on public.friend_requests (to_user);

alter table public.friend_requests enable row level security;
revoke all on table public.friend_requests from public, anon, authenticated;
grant select on table public.friend_requests to authenticated;

create policy "See your own friend requests"
on public.friend_requests for select to authenticated
using ((select auth.uid()) in (from_user, to_user));

create table public.pact_join_requests (
    pact_id uuid not null references public.pacts(pact_id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    invited_by uuid not null references auth.users(id) on delete cascade,
    status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
    created_at timestamptz not null default now(),
    responded_at timestamptz,
    primary key (pact_id, user_id)
);

create index pact_join_requests_user_idx on public.pact_join_requests (user_id);

alter table public.pact_join_requests enable row level security;
revoke all on table public.pact_join_requests from public, anon, authenticated;
grant select on table public.pact_join_requests to authenticated;

create policy "See your invites and your pacts' invites"
on public.pact_join_requests for select to authenticated
using (
    user_id = (select auth.uid())
    or exists (
        select 1 from public.pact_members m
        where m.pact_id = pact_join_requests.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'
    )
);

-- True when the two people have an accepted friend request either way.
create or replace function public.are_friends(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from public.friend_requests
        where status = 'accepted'
          and ((from_user = p_a and to_user = p_b) or (from_user = p_b and to_user = p_a))
    );
$$;

-- Ask someone to be friends by the email they sign in with. If they already asked you, this accepts it.
create or replace function public.send_friend_request(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller uuid := auth.uid();
    target uuid;
begin
    if caller is null then
        raise exception 'Sign in first' using errcode = '42501';
    end if;
    select id into target from public.profiles where lower(email) = lower(btrim(p_email)) limit 1;
    if target is null then
        raise exception 'Nobody on Pact uses that email yet';
    end if;
    if target = caller then
        raise exception 'That is your own email';
    end if;

    if exists (select 1 from public.friend_requests where from_user = target and to_user = caller and status = 'pending') then
        update public.friend_requests set status = 'accepted', responded_at = now()
        where from_user = target and to_user = caller;
        return 'accepted';
    end if;
    if public.are_friends(caller, target) then
        return 'accepted';
    end if;

    insert into public.friend_requests (from_user, to_user)
    values (caller, target)
    on conflict (from_user, to_user) do update set status = 'pending', created_at = now(), responded_at = null
    where public.friend_requests.status = 'declined';
    return 'pending';
end;
$$;

create or replace function public.respond_friend_request(p_request_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.friend_requests
    set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now()
    where request_id = p_request_id and to_user = auth.uid() and status = 'pending';
    if not found then
        raise exception 'That request is no longer waiting on you';
    end if;
end;
$$;

-- Pending requests sent to me and by me, with the other person's name and photo.
create or replace function public.list_friend_requests()
returns table (request_id uuid, incoming boolean, user_id uuid, name text, email text, avatar_url text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
    select r.request_id,
           r.to_user = auth.uid(),
           p.id, p.name, p.email, p.avatar_url, r.created_at
    from public.friend_requests r
    join public.profiles p on p.id = case when r.to_user = auth.uid() then r.from_user else r.to_user end
    where r.status = 'pending' and auth.uid() in (r.from_user, r.to_user)
    order by r.created_at desc;
$$;

create or replace function public.list_friends()
returns table (user_id uuid, name text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
    select p.id, p.name, p.avatar_url
    from public.friend_requests r
    join public.profiles p on p.id = case when r.to_user = auth.uid() then r.from_user else r.to_user end
    where r.status = 'accepted' and auth.uid() in (r.from_user, r.to_user)
    order by p.name;
$$;

-- Any member can ask their friends in. People already in the pact are skipped.
create or replace function public.invite_to_pact(p_pact_id uuid, p_user_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller uuid := auth.uid();
    target uuid;
    asked integer := 0;
begin
    if not exists (
        select 1 from public.pact_members
        where pact_id = p_pact_id and user_id = caller and membership_status = 'active'
    ) then
        raise exception 'Only people in this pact can ask others in' using errcode = '42501';
    end if;

    foreach target in array coalesce(p_user_ids, '{}') loop
        continue when target = caller;
        continue when exists (
            select 1 from public.pact_members
            where pact_id = p_pact_id and user_id = target and membership_status = 'active'
        );
        if not public.are_friends(caller, target) then
            raise exception 'You can only ask friends into a pact';
        end if;
        insert into public.pact_join_requests (pact_id, user_id, invited_by)
        values (p_pact_id, target, caller)
        on conflict (pact_id, user_id) do update
            set status = 'pending', invited_by = caller, created_at = now(), responded_at = null
            where public.pact_join_requests.status <> 'pending';
        asked := asked + 1;
    end loop;
    return asked;
end;
$$;

-- Saying yes makes you a member, keeping any role you had before.
create or replace function public.respond_pact_invite(p_pact_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller uuid := auth.uid();
begin
    update public.pact_join_requests
    set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now()
    where pact_id = p_pact_id and user_id = caller and status = 'pending';
    if not found then
        raise exception 'That invite is no longer waiting on you';
    end if;

    if p_accept then
        insert into public.pact_members (pact_id, user_id, role, membership_status)
        values (p_pact_id, caller, 'member', 'active')
        on conflict (pact_id, user_id) do update set membership_status = 'active'
        where public.pact_members.membership_status <> 'active';
    end if;
end;
$$;

-- Pacts I've been asked into, with who asked.
create or replace function public.list_my_pact_invites()
returns table (pact_id uuid, pact_name text, invited_by uuid, inviter_name text, inviter_avatar_url text, member_count bigint, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
    select j.pact_id, p.name, j.invited_by, inviter.name, inviter.avatar_url,
           (select count(*) from public.pact_members m where m.pact_id = j.pact_id and m.membership_status = 'active'),
           j.created_at
    from public.pact_join_requests j
    join public.pacts p on p.pact_id = j.pact_id
    left join public.profiles inviter on inviter.id = j.invited_by
    where j.user_id = auth.uid() and j.status = 'pending'
    order by j.created_at desc;
$$;

-- Who's been asked into a pact and hasn't answered yet. Members only.
create or replace function public.list_pact_join_requests(p_pact_id uuid)
returns table (user_id uuid, name text, avatar_url text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not exists (
        select 1 from public.pact_members m
        where m.pact_id = p_pact_id and m.user_id = auth.uid() and m.membership_status = 'active'
    ) then
        raise exception 'Active Pact membership required' using errcode = '42501';
    end if;
    return query
        select p.id, p.name, p.avatar_url
        from public.pact_join_requests j
        join public.profiles p on p.id = j.user_id
        where j.pact_id = p_pact_id and j.status = 'pending';
end;
$$;

revoke all on function public.are_friends(uuid, uuid) from public, anon, authenticated;
revoke all on function public.send_friend_request(text) from public, anon;
revoke all on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke all on function public.list_friend_requests() from public, anon;
revoke all on function public.list_friends() from public, anon;
revoke all on function public.invite_to_pact(uuid, uuid[]) from public, anon;
revoke all on function public.respond_pact_invite(uuid, boolean) from public, anon;
revoke all on function public.list_my_pact_invites() from public, anon;
revoke all on function public.list_pact_join_requests(uuid) from public, anon;

grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.list_friend_requests() to authenticated;
grant execute on function public.list_friends() to authenticated;
grant execute on function public.invite_to_pact(uuid, uuid[]) to authenticated;
grant execute on function public.respond_pact_invite(uuid, boolean) to authenticated;
grant execute on function public.list_my_pact_invites() to authenticated;
grant execute on function public.list_pact_join_requests(uuid) to authenticated;
