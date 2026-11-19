-- Delete a pact (the coordinator only) and leave a pact (anyone). Both are blocked while money is held in the pact,
-- so nobody's paid share goes missing: the coordinator cancels the collection first and everyone claims it back.
begin;

-- The coordinator deletes the whole pact: chat, plan, votes, tab and all.
create or replace function public.delete_pact(p_pact_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare caller uuid := auth.uid();
begin
  if caller is null or not exists (
    select 1 from public.pact_members
    where pact_id = p_pact_id and user_id = caller and role = 'host' and membership_status = 'active'
  ) then
    raise exception 'Only the coordinator can delete this pact' using errcode = '42501';
  end if;
  if exists (select 1 from public.pact_payments where pact_id = p_pact_id and status = 'open')
     and exists (select 1 from public.pact_shares where pact_id = p_pact_id and status = 'paid') then
    raise exception 'Money is held in this pact. Cancel the collection so everyone gets their share back, then delete it';
  end if;
  -- These point at the pact's payments without cascading, so they go first.
  delete from public.pact_payment_obligations where pact_id = p_pact_id;
  delete from public.pact_rebalance_proposals where pact_id = p_pact_id;
  delete from public.pact_booking_payment_plans where pact_id = p_pact_id;
  delete from public.pacts where pact_id = p_pact_id;
end; $$;

-- Anyone leaves. The row stays, marked left, so the chat keeps their name. The coordinator hands on the role first,
-- or deletes the pact if they're the only one in it.
create or replace function public.leave_pact(p_pact_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare caller uuid := auth.uid(); me public.pact_members;
begin
  select * into me from public.pact_members where pact_id = p_pact_id and user_id = caller and membership_status = 'active';
  if caller is null or me.user_id is null then
    raise exception 'You are not in this pact' using errcode = '42501';
  end if;
  if me.role = 'host' then
    if exists (select 1 from public.pact_members where pact_id = p_pact_id and user_id <> caller and membership_status = 'active') then
      raise exception 'Hand the coordinator role to someone else in Settings before you leave';
    end if;
    raise exception 'You are the only one here. Delete the pact instead';
  end if;
  if exists (select 1 from public.pact_payments where pact_id = p_pact_id and status = 'open') then
    raise exception 'The split is set up, so your share is part of it. Ask the coordinator to cancel the collection first';
  end if;
  update public.pact_members set membership_status = 'left' where pact_id = p_pact_id and user_id = caller;
end; $$;

revoke all on function public.delete_pact(uuid), public.leave_pact(uuid) from public, anon;
grant execute on function public.delete_pact(uuid), public.leave_pact(uuid) to authenticated;
commit;
