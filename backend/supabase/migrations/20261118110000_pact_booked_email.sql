-- When a pact is booked (the coordinator releases the money on PactSplit and pact_payments turns 'released'),
-- every active member gets a "You're booked" email with the plan. The email is queued here; the email worker
-- sends it. The wallet function wakes the worker right after it saves the release, so nothing waits on a timer.
begin;

alter table public.pact_email_outbox drop constraint if exists pact_email_outbox_email_type_check;
alter table public.pact_email_outbox add constraint pact_email_outbox_email_type_check
  check (email_type in ('demo_itinerary', 'verified_payment_receipt', 'pact_booked'));

create or replace function public.enqueue_pact_booked_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'released' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into public.pact_email_outbox (pact_id, recipient_user_id, email_type, entity_id, payload)
    select new.pact_id, m.user_id, 'pact_booked', new.payment_id, jsonb_build_object('payment_id', new.payment_id)
    from public.pact_members m
    where m.pact_id = new.pact_id and m.membership_status = 'active'
    on conflict (email_type, entity_id, recipient_user_id) do nothing;
  end if;
  return new;
end; $$;

drop trigger if exists pact_booked_email_outbox on public.pact_payments;
create trigger pact_booked_email_outbox after insert or update of status on public.pact_payments
for each row execute function public.enqueue_pact_booked_email();

revoke all on function public.enqueue_pact_booked_email() from public, anon, authenticated;
commit;
