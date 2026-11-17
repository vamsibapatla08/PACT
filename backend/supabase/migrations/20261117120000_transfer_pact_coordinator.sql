-- The coordinator (host) hands the role to another active member. There is one coordinator per pact,
-- because they collect the money. Once a split is saved the payee is fixed, so the role is locked from then on.

create or replace function public.transfer_pact_coordinator(p_pact_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller uuid := auth.uid();
begin
    if not exists (
        select 1 from public.pact_members
        where pact_id = p_pact_id and user_id = caller and role = 'host' and membership_status = 'active'
    ) then
        raise exception 'Only the coordinator can change roles' using errcode = '42501';
    end if;
    if p_user_id = caller then
        return;
    end if;
    if not exists (
        select 1 from public.pact_members
        where pact_id = p_pact_id and user_id = p_user_id and membership_status = 'active'
    ) then
        raise exception 'That person is not in this pact';
    end if;
    if exists (select 1 from public.pact_payments where pact_id = p_pact_id) then
        raise exception 'Roles are locked once the split is set up';
    end if;

    update public.pact_members set role = 'member' where pact_id = p_pact_id and user_id = caller;
    update public.pact_members set role = 'host' where pact_id = p_pact_id and user_id = p_user_id;
end;
$$;

revoke all on function public.transfer_pact_coordinator(uuid, uuid) from public, anon;
grant execute on function public.transfer_pact_coordinator(uuid, uuid) to authenticated;
