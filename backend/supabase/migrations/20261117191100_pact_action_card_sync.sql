begin;

create or replace function public.sync_pact_action_card_state()
returns trigger language plpgsql security definer set search_path = '' as $$
declare next_state text; target uuid;
begin
  next_state := case new.status when 'approved' then 'approved' when 'rejected' then 'rejected' when 'confirmed' then 'completed' when 'demo_confirmed' then 'completed' when 'paid' then 'completed' when 'refunded' then 'completed' when 'released' then 'completed' when 'cancelled' then 'rejected' else null end;
  if tg_table_name = 'pact_decisions' then target := new.decision_id;
  elsif tg_table_name = 'pact_bookings' then target := new.booking_id;
  elsif tg_table_name = 'pact_booking_splits' then target := new.split_id;
  elsif tg_table_name = 'pact_rebalance_proposals' then target := new.proposal_id;
  elsif tg_table_name = 'pact_payments' then target := new.payment_id;
  elsif tg_table_name = 'pact_shares' then target := new.share_id;
  end if;
  if next_state is not null and target is not null then update public.pact_action_cards set state=next_state,updated_at=now() where target_id=target; end if;
  return new;
end; $$;

drop trigger if exists pact_decision_action_card_sync on public.pact_decisions;
create trigger pact_decision_action_card_sync after update of status on public.pact_decisions for each row execute function public.sync_pact_action_card_state();
drop trigger if exists pact_booking_action_card_sync on public.pact_bookings;
create trigger pact_booking_action_card_sync after update of status on public.pact_bookings for each row execute function public.sync_pact_action_card_state();
drop trigger if exists pact_split_action_card_sync on public.pact_booking_splits;
create trigger pact_split_action_card_sync after update of status on public.pact_booking_splits for each row execute function public.sync_pact_action_card_state();
drop trigger if exists pact_rebalance_action_card_sync on public.pact_rebalance_proposals;
create trigger pact_rebalance_action_card_sync after update of status on public.pact_rebalance_proposals for each row execute function public.sync_pact_action_card_state();
drop trigger if exists pact_payment_action_card_sync on public.pact_payments;
create trigger pact_payment_action_card_sync after update of status on public.pact_payments for each row execute function public.sync_pact_action_card_state();
drop trigger if exists pact_share_action_card_sync on public.pact_shares;
create trigger pact_share_action_card_sync after update of status on public.pact_shares for each row execute function public.sync_pact_action_card_state();

revoke all on function public.sync_pact_action_card_state() from public, anon, authenticated;
commit;
