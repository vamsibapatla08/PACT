begin;

-- Nothing wrote on-chain payments back to pact_shares, so a fully paid pact still read as owed and its Fund
-- step never completed. The wallet function's pact_status reads PactSplit live and now saves what it sees
-- here. Only the server calls this, with the contract's state and the members it reports as paid.
create or replace function public.sync_pact_chain_status(p_pact_id uuid, p_state text, p_paid_user_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment public.pact_payments;
begin
  if p_state is null or p_state not in ('open', 'released', 'cancelled') then return; end if;

  select * into payment from public.pact_payments where pact_id = p_pact_id for update;
  if not found then return; end if;

  -- Members the contract says paid. A share row is added when a member got a wallet after the plan was saved.
  insert into public.pact_shares (payment_id, pact_id, user_id, wallet_address, status, amount_usdc, paid_at)
  select payment.payment_id, p_pact_id, m.user_id, w.address, 'paid', payment.share_usdc, now()
  from public.pact_members m
  left join public.wallets w on w.user_id = m.user_id
  where m.pact_id = p_pact_id and m.membership_status = 'active' and m.user_id = any(coalesce(p_paid_user_ids, '{}'))
  on conflict (payment_id, user_id) do update
    set status = 'paid', paid_at = coalesce(public.pact_shares.paid_at, now())
    where public.pact_shares.status = 'owed';

  -- After a cancel, a share the contract no longer counts as paid has been claimed back.
  if p_state = 'cancelled' then
    update public.pact_shares
    set status = 'refunded', refunded_at = now()
    where payment_id = payment.payment_id and status = 'paid'
      and not (user_id = any(coalesce(p_paid_user_ids, '{}')));
  end if;

  if p_state <> 'open' and payment.status = 'open' then
    update public.pact_payments set status = p_state, updated_at = now() where payment_id = payment.payment_id;
  end if;
end;
$$;

revoke all on function public.sync_pact_chain_status(uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function public.sync_pact_chain_status(uuid, text, uuid[]) to service_role;

-- Same as before, except a share the sync marked paid without a tx hash takes the stream's event details
-- instead of being rejected as a conflict.
create or replace function public.record_pact_share_payment(
  p_payment_id uuid,
  p_user_id uuid,
  p_wallet_address text,
  p_tx_hash text,
  p_event_log_index bigint,
  p_block_number bigint,
  p_amount_usdc numeric,
  p_chain_id bigint,
  p_contract_address text
)
returns public.pact_shares
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment public.pact_payments;
  result public.pact_shares;
begin
  select * into payment
  from public.pact_payments
  where payment_id = p_payment_id
  for update;

  if not found or payment.status <> 'open' then
    raise exception 'Payment plan is unavailable';
  end if;
  if p_chain_id is null or p_contract_address is null or p_chain_id <> payment.chain_id or lower(p_contract_address) <> lower(payment.contract_address) then
    raise exception 'Unverified payment network or contract';
  end if;
  if p_amount_usdc is null or p_amount_usdc <> payment.share_usdc then
    raise exception 'Payment amount does not match the share';
  end if;
  if p_wallet_address is null or not exists (
    select 1 from public.wallets w
    where w.user_id = p_user_id
      and lower(w.address) = lower(p_wallet_address)
  ) then
    raise exception 'Payment wallet does not belong to the Pact member';
  end if;
  if not exists (
    select 1 from public.pact_members m
    where m.pact_id = payment.pact_id
      and m.user_id = p_user_id
      and m.membership_status = 'active'
  ) then
    raise exception 'User is not an active Pact member' using errcode = '42501';
  end if;
  if p_tx_hash is null or p_event_log_index is null then
    raise exception 'Blockchain event identity is required';
  end if;

  select * into result
  from public.pact_shares
  where payment_id = payment.payment_id and user_id = p_user_id
  for update;

  if found then
    if result.status = 'paid' and result.tx_hash = p_tx_hash and result.event_log_index = p_event_log_index then
      return result;
    end if;
    if result.status = 'owed' or (result.status = 'paid' and result.tx_hash is null) then
      update public.pact_shares
      set wallet_address = p_wallet_address,
          status = 'paid',
          tx_hash = p_tx_hash,
          event_log_index = p_event_log_index,
          block_number = p_block_number,
          paid_at = coalesce(paid_at, now())
      where share_id = result.share_id
      returning * into result;
      return result;
    end if;
    raise exception 'Conflicting payment event for this Pact share';
  end if;

  insert into public.pact_shares (
    payment_id, pact_id, user_id, wallet_address, status, amount_usdc,
    tx_hash, event_log_index, block_number, paid_at
  ) values (
    payment.payment_id, payment.pact_id, p_user_id, p_wallet_address, 'paid',
    p_amount_usdc, p_tx_hash, p_event_log_index, p_block_number, now()
  )
  on conflict (payment_id, user_id) do nothing;

  select * into result
  from public.pact_shares
  where payment_id = payment.payment_id and user_id = p_user_id;

  return result;
end;
$$;

-- Same as before, plus: saving a funding plan counts as planning, and once a step is complete every step
-- before it is too, since the group can't be paying for something it never planned or agreed on.
create or replace function public.refresh_pact_milestones(p_pact_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  planned boolean;
  decided boolean;
  funded boolean;
begin
  select exists (select 1 from public.pact_recommendations where pact_id = p_pact_id)
      or exists (select 1 from public.pact_decisions where pact_id = p_pact_id)
      or exists (select 1 from public.pact_payments where pact_id = p_pact_id)
    into planned;

  select exists (select 1 from public.pact_decisions where pact_id = p_pact_id and status = 'approved')
    into decided;

  select exists (select 1 from public.pact_payments where pact_id = p_pact_id and status = 'released')
      or exists (
        select 1 from public.pact_payments p
        where p.pact_id = p_pact_id and p.status = 'open'
          and exists (select 1 from public.pact_shares s where s.payment_id = p.payment_id)
          and not exists (select 1 from public.pact_shares s where s.payment_id = p.payment_id and s.status = 'owed')
      )
    into funded;

  update public.pact_milestones
  set status = 'complete', completed_at = coalesce(completed_at, now())
  where pact_id = p_pact_id
    and status <> 'complete'
    and (
      (milestone_kind = 'planning' and planned)
      or (milestone_kind = 'decision' and decided)
      or (milestone_kind = 'funding' and funded)
    );

  update public.pact_milestones
  set status = 'complete', completed_at = coalesce(completed_at, now())
  where pact_id = p_pact_id
    and status <> 'complete'
    and position < (select max(position) from public.pact_milestones where pact_id = p_pact_id and status = 'complete');

  update public.pact_milestones m
  set status = case
    when m.position = (
      select min(position) from public.pact_milestones
      where pact_id = p_pact_id and status <> 'complete'
    ) then 'in_progress'
    else 'pending'
  end
  where m.pact_id = p_pact_id and m.status <> 'complete';
end;
$$;

revoke all on function public.refresh_pact_milestones(uuid) from public, anon, authenticated;

commit;
