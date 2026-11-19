-- A person's share record must always say the real amount. Shares were written when the split was saved and kept
-- that amount when the plan's share changed later (an item removed, a group price), so "You paid $21.49" showed
-- for a $1.49 payment. Now: owed shares follow the plan, and a share marked paid takes the plan's current amount.
begin;

create or replace function public.sync_pact_chain_status(p_pact_id uuid, p_state text, p_paid_user_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
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
    set status = 'paid', paid_at = coalesce(public.pact_shares.paid_at, now()), amount_usdc = payment.share_usdc
    where public.pact_shares.status = 'owed';

  -- Whoever hasn't paid owes the plan's current share.
  update public.pact_shares set amount_usdc = payment.share_usdc
  where payment_id = payment.payment_id and status = 'owed' and amount_usdc is distinct from payment.share_usdc;

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

-- Owed shares follow the plan whenever its share changes (removing an item, a group price, any edit).
create or replace function public.pact_shares_follow_plan()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.share_usdc is distinct from old.share_usdc then
    update public.pact_shares set amount_usdc = new.share_usdc where payment_id = new.payment_id and status = 'owed';
  end if;
  return new;
end; $$;
drop trigger if exists pact_shares_follow_plan on public.pact_payments;
create trigger pact_shares_follow_plan after update of share_usdc on public.pact_payments
for each row execute function public.pact_shares_follow_plan();
revoke all on function public.pact_shares_follow_plan() from public, anon, authenticated;

commit;
