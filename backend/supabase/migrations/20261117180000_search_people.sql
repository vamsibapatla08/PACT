-- Find people on Pact by name or email to add as friends. Results show only a name and photo, never an email,
-- and only for a search of at least two characters, so nobody can list everyone.

create or replace function public.search_people(p_query text)
returns table (user_id uuid, name text, avatar_url text, status text)
language sql
stable
security definer
set search_path = ''
as $$
    select p.id, p.name, p.avatar_url,
           case
               when public.are_friends(auth.uid(), p.id) then 'friend'
               when exists (select 1 from public.friend_requests r
                            where r.status = 'pending' and r.from_user = auth.uid() and r.to_user = p.id) then 'requested'
               when exists (select 1 from public.friend_requests r
                            where r.status = 'pending' and r.from_user = p.id and r.to_user = auth.uid()) then 'asked_you'
               else 'none'
           end
    from public.profiles p
    where auth.uid() is not null
      and p.id <> auth.uid()
      and char_length(btrim(p_query)) >= 2
      and (p.name ilike '%' || btrim(p_query) || '%' or lower(p.email) = lower(btrim(p_query)))
    order by p.name
    limit 20;
$$;

-- Ask someone to be friends from a search result. Same rules as asking by email.
create or replace function public.send_friend_request_to(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller uuid := auth.uid();
begin
    if caller is null then
        raise exception 'Sign in first' using errcode = '42501';
    end if;
    if p_user_id = caller then
        raise exception 'That is you';
    end if;
    if not exists (select 1 from public.profiles where id = p_user_id) then
        raise exception 'Nobody on Pact uses that account';
    end if;

    if exists (select 1 from public.friend_requests where from_user = p_user_id and to_user = caller and status = 'pending') then
        update public.friend_requests set status = 'accepted', responded_at = now()
        where from_user = p_user_id and to_user = caller;
        return 'accepted';
    end if;
    if public.are_friends(caller, p_user_id) then
        return 'accepted';
    end if;

    insert into public.friend_requests (from_user, to_user)
    values (caller, p_user_id)
    on conflict (from_user, to_user) do update set status = 'pending', created_at = now(), responded_at = null
    where public.friend_requests.status = 'declined';
    return 'pending';
end;
$$;

revoke all on function public.search_people(text) from public, anon;
revoke all on function public.send_friend_request_to(uuid) from public, anon;
grant execute on function public.search_people(text) to authenticated;
grant execute on function public.send_friend_request_to(uuid) to authenticated;
