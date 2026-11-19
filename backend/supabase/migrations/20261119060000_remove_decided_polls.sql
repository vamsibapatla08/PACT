-- A decided vote can be cleared away too. Its pick is its own row on the plan, so removing the vote card never
-- touches the plan. Whoever started the vote (for Pact Pilot's, whoever asked) or the coordinator can remove it.
begin;

create or replace function public.remove_pact_poll(p_poll_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare caller uuid := auth.uid(); poll public.pact_polls;
begin
  select * into poll from public.pact_polls where poll_id = p_poll_id for update;
  if poll.poll_id is null then return; end if;
  if caller is null or not exists (
    select 1 from public.pact_members m
    where m.pact_id = poll.pact_id and m.user_id = caller and m.membership_status = 'active'
      and (m.role = 'host' or poll.created_by = caller)
  ) then
    raise exception 'Only whoever started this vote, or the coordinator, can remove it' using errcode = '42501';
  end if;
  delete from public.pact_polls where poll_id = p_poll_id;
end; $$;

revoke all on function public.remove_pact_poll(uuid) from public, anon;
grant execute on function public.remove_pact_poll(uuid) to authenticated;
commit;
