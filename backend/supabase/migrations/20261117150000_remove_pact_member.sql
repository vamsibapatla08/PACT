-- The coordinator takes someone out of a pact. Like handing on the role, this is locked once a split is set up,
-- because each person's share is fixed from then on. The row stays, marked removed, so the chat keeps their name.

create or replace function public.remove_pact_member(p_pact_id uuid, p_user_id uuid)
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
        raise exception 'Only the coordinator can remove people' using errcode = '42501';
    end if;
    if p_user_id = caller then
        raise exception 'Hand on the coordinator role before leaving';
    end if;
    if exists (select 1 from public.pact_payments where pact_id = p_pact_id) then
        raise exception 'People are locked once the split is set up';
    end if;

    update public.pact_members
    set membership_status = 'removed'
    where pact_id = p_pact_id and user_id = p_user_id and membership_status = 'active';
    if not found then
        raise exception 'That person is not in this pact';
    end if;
end;
$$;

revoke all on function public.remove_pact_member(uuid, uuid) from public, anon;
grant execute on function public.remove_pact_member(uuid, uuid) to authenticated;
