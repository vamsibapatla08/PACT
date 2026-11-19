-- Rounds: a collection can be cancelled (everyone takes their share back) and opened again. PactSplit never reopens
-- a pact id, so each round gets its own on-chain id: the pact's 16 uuid bytes, then the round number in the other 16
-- (round 0 is all zeros, so every collection opened before this keeps its id).
--
-- Someone leaving mid-collection marks the plan to reopen. The total stays the same and is shared again by the people
-- still in, so the leaver's part is reallocated. The coordinator cancels the open round, then reopens it.
begin;

alter table public.pact_payments
  add column if not exists round integer not null default 0 check (round >= 0),
  add column if not exists needs_reopen boolean not null default false,
  add column if not exists reopen_total numeric(30, 6) check (reopen_total is null or reopen_total > 0);

-- Called by the wallet function (service role) just before it opens a collection on PactSplit. Shares the total
-- again across everyone still in with a wallet, and moves to a new round when the last one was cancelled.
create or replace function public.start_pact_payment_round(p_pact_id uuid, p_new_round boolean)
returns public.pact_payments language plpgsql volatile security definer set search_path = '' as $$
declare
  payment public.pact_payments;
  total numeric;
  people integer;
begin
  select * into payment from public.pact_payments where pact_id = p_pact_id for update;
  if payment.payment_id is null then raise exception 'Make a funding plan for this pact first'; end if;

  total := coalesce(payment.reopen_total, payment.share_usdc * payment.shares_needed);
  select count(*) into people
  from public.pact_members m join public.wallets w on w.user_id = m.user_id
  where m.pact_id = p_pact_id and m.membership_status = 'active';
  if people = 0 then raise exception 'Nobody in this pact has a wallet yet'; end if;

  if p_new_round then
    -- The last round's shares were paid back on chain (or will be claimed); this round starts from nobody paid.
    delete from public.pact_payment_obligations where payment_id = payment.payment_id;
    delete from public.pact_shares where payment_id = payment.payment_id;
  end if;

  update public.pact_payments set
    round = payment.round + case when p_new_round then 1 else 0 end,
    -- Rounded up to the cent, so the shares always cover the total.
    share_usdc = ceil(total * 100 / people) / 100,
    shares_needed = people,
    deadline = greatest(payment.deadline, now() + interval '7 days'),
    status = 'open',
    needs_reopen = false,
    reopen_total = null,
    updated_at = now()
  where payment_id = payment.payment_id
  returning * into payment;
  return payment;
end; $$;

revoke all on function public.start_pact_payment_round(uuid, boolean) from public, anon, authenticated;
grant execute on function public.start_pact_payment_round(uuid, boolean) to service_role;

-- Leaving now works mid-collection too: the plan is marked to reopen, so the leaver's part is shared by the rest.
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
  update public.pact_payments
  set needs_reopen = true, reopen_total = coalesce(reopen_total, share_usdc * shares_needed), updated_at = now()
  where pact_id = p_pact_id and status in ('open', 'cancelled');
  update public.pact_members set membership_status = 'left' where pact_id = p_pact_id and user_id = caller;
end; $$;

revoke all on function public.leave_pact(uuid) from public, anon;
grant execute on function public.leave_pact(uuid) to authenticated;
commit;
