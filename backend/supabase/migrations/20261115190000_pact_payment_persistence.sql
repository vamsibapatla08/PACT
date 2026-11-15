begin;

create table public.pact_payments (
  payment_id uuid primary key default gen_random_uuid(),
  pact_id uuid not null unique references public.pacts(pact_id) on delete cascade,
  created_by uuid not null references auth.users(id),
  payee_address text not null,
  share_usdc numeric(30, 6) not null check (share_usdc > 0),
  shares_needed integer not null check (shares_needed > 0),
  deadline timestamptz not null,
  chain_id bigint not null default 5042002 check (chain_id = 5042002),
  contract_address text not null,
  status text not null default 'open' check (status in ('open', 'released', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_id, pact_id)
);

create table public.pact_shares (
  share_id uuid primary key default gen_random_uuid(),
  payment_id uuid not null,
  pact_id uuid not null,
  user_id uuid not null references auth.users(id),
  wallet_address text,
  status text not null default 'owed' check (status in ('owed', 'paid', 'refunded')),
  amount_usdc numeric(30, 6) not null check (amount_usdc > 0),
  tx_hash text,
  event_log_index bigint,
  block_number bigint,
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (payment_id, user_id),
  unique (tx_hash, event_log_index),
  foreign key (payment_id, pact_id) references public.pact_payments(payment_id, pact_id) on delete cascade
);

create table public.pact_payment_events (
  event_id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.pact_payments(payment_id) on delete cascade,
  pact_id uuid not null references public.pacts(pact_id) on delete cascade,
  event_type text not null check (event_type in ('released', 'cancelled', 'refunded')),
  event_signature text not null,
  tx_hash text not null,
  event_log_index bigint not null,
  block_number bigint,
  chain_id bigint not null check (chain_id = 5042002),
  contract_address text not null,
  user_id uuid references auth.users(id),
  amount_usdc numeric(30, 6),
  created_at timestamptz not null default now(),
  unique (chain_id, contract_address, tx_hash, event_log_index)
);

create index pact_payments_pact_status_idx on public.pact_payments(pact_id, status);
create index pact_shares_pact_status_idx on public.pact_shares(pact_id, status);
create index pact_shares_payment_idx on public.pact_shares(payment_id);
create index pact_payment_events_payment_idx on public.pact_payment_events(payment_id, event_type);

alter table public.pact_payments enable row level security;
alter table public.pact_shares enable row level security;
alter table public.pact_payment_events enable row level security;

revoke all on public.pact_payments, public.pact_shares, public.pact_payment_events from public, anon, authenticated;
grant select on public.pact_payments, public.pact_shares, public.pact_payment_events to authenticated;

create policy "Active Pact members read payment plans"
on public.pact_payments for select to authenticated
using (
  exists (
    select 1 from public.pact_members m
    where m.pact_id = pact_payments.pact_id
      and m.user_id = (select auth.uid())
      and m.membership_status = 'active'
  )
);

create policy "Active Pact members read shares"
on public.pact_shares for select to authenticated
using (
  exists (
    select 1 from public.pact_members m
    where m.pact_id = pact_shares.pact_id
      and m.user_id = (select auth.uid())
      and m.membership_status = 'active'
  )
);

create policy "Active Pact members read payment events"
on public.pact_payment_events for select to authenticated
using (
  exists (
    select 1 from public.pact_members m
    where m.pact_id = pact_payment_events.pact_id
      and m.user_id = (select auth.uid())
      and m.membership_status = 'active'
  )
);

create or replace function public.create_pact_payment_plan(
  p_pact_id uuid,
  p_host_user_id uuid,
  p_payee_address text,
  p_share_usdc numeric,
  p_shares_needed integer,
  p_deadline timestamptz,
  p_chain_id bigint,
  p_contract_address text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  if not exists (select 1 from public.pact_members m where m.pact_id = p_pact_id and m.user_id = p_host_user_id and m.role = 'host' and m.membership_status = 'active') then raise exception 'Active Pact host required' using errcode = '42501'; end if;
  if p_payee_address is null or p_payee_address !~ '^0x[0-9a-fA-F]{40}$' then raise exception 'Invalid payee address'; end if;
  if p_share_usdc is null or p_share_usdc <= 0 or p_share_usdc <> round(p_share_usdc, 6) or p_shares_needed is null or p_shares_needed <= 0 then raise exception 'Invalid Pact share configuration'; end if;
  if p_deadline is null or p_deadline <= now() then raise exception 'Payment deadline must be in the future'; end if;
  if p_chain_id is null or p_chain_id <> 5042002 or p_contract_address is null or p_contract_address !~ '^0x[0-9a-fA-F]{40}$' then raise exception 'Invalid Arc payment contract configuration'; end if;
  insert into public.pact_payments (pact_id, created_by, payee_address, share_usdc, shares_needed, deadline, chain_id, contract_address)
  values (p_pact_id, p_host_user_id, p_payee_address, p_share_usdc, p_shares_needed, p_deadline, p_chain_id, lower(p_contract_address))
  returning payment_id into result;
  insert into public.pact_shares (payment_id, pact_id, user_id, amount_usdc)
  select result, p_pact_id, m.user_id, p_share_usdc from public.pact_members m where m.pact_id = p_pact_id and m.membership_status = 'active';
  return result;
end;
$$;

create or replace function public.record_pact_payment_event(
  p_payment_id uuid, p_event_type text, p_event_signature text, p_user_id uuid,
  p_tx_hash text, p_event_log_index bigint, p_block_number bigint,
  p_chain_id bigint, p_contract_address text, p_amount_usdc numeric default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare payment public.pact_payments; share public.pact_shares; result uuid; expected_signature text;
begin
  select * into payment from public.pact_payments where payment_id = p_payment_id for update;
  if not found then raise exception 'Payment plan is unavailable'; end if;
  if p_event_type not in ('released', 'cancelled', 'refunded') then raise exception 'Invalid payment event'; end if;
  if p_chain_id is null or p_contract_address is null or p_chain_id <> payment.chain_id or lower(p_contract_address) <> lower(payment.contract_address) then raise exception 'Unverified payment network or contract'; end if;
  if p_event_signature is null or p_tx_hash is null or p_event_log_index is null then raise exception 'Blockchain event identity is required'; end if;
  expected_signature := case p_event_type when 'released' then '0xc8fa66dff4b9073528c3f1bf21a8dc9a18fdf09847e88e96188bc953aef519f0' when 'cancelled' then '0xbaa1eb22f2a492ba1a5fea61b8df4d27c6c8b5f3971e63bb58fa14ff72eedb70' when 'refunded' then '0xf552ca82e113ac3c539c3d617f29fcd19c172a0c75dad017555c9e109f7fe183' end;
  if lower(p_event_signature) <> expected_signature then raise exception 'Unexpected PactSplit event signature'; end if;
  select event_id into result from public.pact_payment_events where chain_id = p_chain_id and lower(contract_address) = lower(p_contract_address) and tx_hash = p_tx_hash and event_log_index = p_event_log_index;
  if found then return result; end if;
  if p_event_type = 'released' then
    if payment.status <> 'open' then raise exception 'Payment plan is not open'; end if;
    if p_amount_usdc is null or p_amount_usdc <> payment.share_usdc * payment.shares_needed then raise exception 'Release amount does not match the payment plan'; end if;
    update public.pact_payments set status = 'released', updated_at = now() where payment_id = p_payment_id;
  elsif p_event_type = 'cancelled' then
    if payment.status <> 'open' then raise exception 'Payment plan is not open'; end if;
    update public.pact_payments set status = 'cancelled', updated_at = now() where payment_id = p_payment_id;
  else
    if payment.status <> 'cancelled' or p_user_id is null then raise exception 'Refund requires a cancelled plan and member'; end if;
    select * into share from public.pact_shares where payment_id = p_payment_id and user_id = p_user_id for update;
    if not found or share.status <> 'paid' then raise exception 'Only a paid share can be refunded'; end if;
    if p_amount_usdc is null or p_amount_usdc <> share.amount_usdc then raise exception 'Refund amount does not match the paid share'; end if;
    update public.pact_shares set status = 'refunded', refunded_at = now() where share_id = share.share_id;
  end if;
  insert into public.pact_payment_events (payment_id, pact_id, event_type, event_signature, tx_hash, event_log_index, block_number, chain_id, contract_address, user_id, amount_usdc)
  values (p_payment_id, payment.pact_id, p_event_type, lower(p_event_signature), p_tx_hash, p_event_log_index, p_block_number, p_chain_id, lower(p_contract_address), p_user_id, p_amount_usdc)
  returning event_id into result;
  return result;
end;
$$;

create or replace function public.get_pact_payment_status(p_pact_id uuid)
returns table (
  payment_id uuid,
  pact_id uuid,
  payee_address text,
  share_usdc numeric,
  shares_needed integer,
  deadline timestamptz,
  chain_id bigint,
  contract_address text,
  payment_status text,
  share_id uuid,
  user_id uuid,
  wallet_address text,
  share_status text,
  amount_usdc numeric,
  tx_hash text,
  paid_at timestamptz,
  refunded_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.pact_members m
    where m.pact_id = p_pact_id
      and m.user_id = auth.uid()
      and m.membership_status = 'active'
  ) then
    raise exception 'Active Pact membership required' using errcode = '42501';
  end if;

  return query
  select p.payment_id, p.pact_id, p.payee_address, p.share_usdc,
    p.shares_needed, p.deadline, p.chain_id, p.contract_address, p.status,
    s.share_id, s.user_id, s.wallet_address, s.status, s.amount_usdc,
    s.tx_hash, s.paid_at, s.refunded_at
  from public.pact_payments p
  left join public.pact_shares s on s.payment_id = p.payment_id
  where p.pact_id = p_pact_id
  order by s.created_at;
end;
$$;

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
    if result.status = 'owed' then
      update public.pact_shares
      set wallet_address = p_wallet_address,
          status = 'paid',
          tx_hash = p_tx_hash,
          event_log_index = p_event_log_index,
          block_number = p_block_number,
          paid_at = now()
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

revoke all on function public.get_pact_payment_status(uuid) from public, anon;
grant execute on function public.get_pact_payment_status(uuid) to authenticated;
revoke all on function public.create_pact_payment_plan(uuid, uuid, text, numeric, integer, timestamptz, bigint, text) from public, anon, authenticated;
grant execute on function public.create_pact_payment_plan(uuid, uuid, text, numeric, integer, timestamptz, bigint, text) to service_role;
revoke all on function public.record_pact_payment_event(uuid, text, text, uuid, text, bigint, bigint, bigint, text, numeric) from public, anon, authenticated;
grant execute on function public.record_pact_payment_event(uuid, text, text, uuid, text, bigint, bigint, bigint, text, numeric) to service_role;
revoke all on function public.record_pact_share_payment(uuid, uuid, text, text, bigint, bigint, numeric, bigint, text) from public, anon, authenticated;
grant execute on function public.record_pact_share_payment(uuid, uuid, text, text, bigint, bigint, numeric, bigint, text) to service_role;

commit;
