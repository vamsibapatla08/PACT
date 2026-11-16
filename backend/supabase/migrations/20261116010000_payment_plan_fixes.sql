begin;

-- The live project's default privileges give service_role no select on new tables, and bypassing RLS
-- does not bypass grants. create-pact-payment-plan and the wallet function read these with the service role.
grant select on table public.pact_payments, public.pact_shares, public.pact_members to service_role;

-- One share per active member who has a wallet, counted inside the same transaction that writes the rows,
-- so shares_needed always matches the share rows and a member who cannot pay never blocks release.
-- p_replace lets the host start over while the plan is not on chain yet (the edge function checks the chain).
drop function public.create_pact_payment_plan(uuid, uuid, text, numeric, integer, timestamptz, bigint, text);

create function public.create_pact_payment_plan(
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
  join public.wallets w on w.user_id = m.user_id
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
