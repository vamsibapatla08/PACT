-- The app's Friends list includes people you already share a pact with, so they can be asked into a new pact
-- too, not only people who accepted a friend request. Same function and rules otherwise.

create or replace function public.can_invite(p_from uuid, p_to uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.are_friends(p_from, p_to)
        or exists (
            select 1
            from public.pact_members a
            join public.pact_members b on b.pact_id = a.pact_id
            where a.user_id = p_from and b.user_id = p_to
              and a.membership_status = 'active' and b.membership_status = 'active'
        );
$$;

revoke all on function public.can_invite(uuid, uuid) from public, anon, authenticated;

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
        if not public.can_invite(caller, target) then
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
