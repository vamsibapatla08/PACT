-- Pact goes back to Arc Testnet (chain 5042002). The Base Sepolia move (20261118000000) never went fully live:
-- PactSplit was never deployed on Base, so no Base payment could happen.
--
-- Wallets: each person has one wallet row. Opening the wallet on Base replaced their Arc row with a Base one.
-- The Arc wallets themselves were never touched: they still exist in Circle and keep every USDC on Arc. Removing
-- the Base rows here lets the wallet function find each person's Arc wallet in Circle again and save it back
-- (no PIN, no new wallet), the next time they open the app.
begin;

-- Payment plans made for Base have nothing on chain behind them (there was no Base contract). Ones a booking or a
-- rebalance still points to are left alone; the host can start those over on Arc from the pact.
delete from public.pact_payments p
where p.chain_id = 84532
  and not exists (select 1 from public.pact_rebalance_proposals r where r.payment_id = p.payment_id)
  and not exists (select 1 from public.pact_booking_payment_plans b where b.payment_id = p.payment_id);

delete from public.wallets where blockchain = 'BASE-SEPOLIA';
alter table public.wallets alter column blockchain set default 'ARC-TESTNET';
alter table public.pact_payments alter column chain_id set default 5042002;

-- Back to the Arc version from 20261116010000_payment_plan_fixes.sql, now also reading only Arc wallet rows.
create or replace function public.create_pact_payment_plan(
  p_pact_id uuid,
  p_host_user_id uuid,
  p_payee_address text,
  p_share_usdc numeric,
  p_deadline timestamptz,
  p_chain_id bigint,
  p_contract_address text,
  p_replace boolean default false
)
returns table (payment_id uuid, shares_needed integer)
language plpgsql security definer set search_path = '' as $$
declare
  result uuid;
  share_count integer;
begin
  if not exists (select 1 from public.pact_members m where m.pact_id = p_pact_id and m.user_id = p_host_user_id and m.role = 'host' and m.membership_status = 'active') then raise exception 'Active Pact host required' using errcode = '42501'; end if;
  if p_payee_address is null or p_payee_address !~ '^0x[0-9a-fA-F]{40}$' or p_payee_address ~ '^0x0{40}$' then raise exception 'Invalid payee address'; end if;
  if p_share_usdc is null or p_share_usdc <= 0 or p_share_usdc > 1000000 or p_share_usdc <> round(p_share_usdc, 6) then raise exception 'Share must be more than 0 and at most 1,000,000 USDC'; end if;
  if p_deadline is null or p_deadline <= now() or p_deadline > now() + interval '90 days' then raise exception 'Deadline must be in the next 90 days'; end if;
  if p_chain_id is null or p_chain_id <> 5042002 or p_contract_address is null or p_contract_address !~ '^0x[0-9a-fA-F]{40}$' then raise exception 'Invalid Arc payment contract configuration'; end if;

  if p_replace then
    delete from public.pact_payments p where p.pact_id = p_pact_id;
  end if;

  insert into public.pact_payments (pact_id, created_by, payee_address, share_usdc, shares_needed, deadline, chain_id, contract_address)
  values (p_pact_id, p_host_user_id, p_payee_address, p_share_usdc, 1, p_deadline, p_chain_id, lower(p_contract_address))
  returning pact_payments.payment_id into result;

  insert into public.pact_shares (payment_id, pact_id, user_id, wallet_address, amount_usdc)
  select result, p_pact_id, m.user_id, w.address, p_share_usdc
  from public.pact_members m
  join public.wallets w on w.user_id = m.user_id and w.blockchain = 'ARC-TESTNET'
  where m.pact_id = p_pact_id and m.membership_status = 'active';
  get diagnostics share_count = row_count;
  if share_count = 0 then raise exception 'No members have a wallet yet'; end if;

  update public.pact_payments p set shares_needed = share_count where p.payment_id = result;
  return query select result, share_count;
end;
$$;

revoke all on function public.create_pact_payment_plan(uuid, uuid, text, numeric, timestamptz, bigint, text, boolean) from public, anon, authenticated;
grant execute on function public.create_pact_payment_plan(uuid, uuid, text, numeric, timestamptz, bigint, text, boolean) to service_role;

commit;
