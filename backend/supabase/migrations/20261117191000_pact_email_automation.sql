begin;

create or replace function public.enqueue_confirmed_pact_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'confirmed' and (tg_op = 'INSERT' or (tg_op <> 'INSERT' and old.status is distinct from new.status)) then
    insert into public.pact_email_outbox(pact_id,recipient_user_id,email_type,entity_id,payload)
    select b.pact_id,m.user_id,'demo_itinerary',new.confirmation_id,jsonb_build_object('booking_id',new.booking_id,'demo',true)
    from public.pact_bookings b join public.pact_members m on m.pact_id=b.pact_id and m.membership_status='active'
    where b.booking_id=new.booking_id on conflict (email_type,entity_id,recipient_user_id) do nothing;
  end if;
  return new;
end; $$;

create or replace function public.enqueue_verified_share_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'paid' and (tg_op = 'INSERT' or (tg_op <> 'INSERT' and old.status is distinct from new.status)) then
    insert into public.pact_email_outbox(pact_id,recipient_user_id,email_type,entity_id,payload)
    values (new.pact_id,new.user_id,'verified_payment_receipt',new.share_id,jsonb_build_object('payment_id',new.payment_id,'amount_usdc',new.amount_usdc))
    on conflict (email_type,entity_id,recipient_user_id) do nothing;
  end if;
  return new;
end; $$;

drop trigger if exists pact_confirmed_email_outbox on public.pact_booking_confirmations;
create trigger pact_confirmed_email_outbox after insert or update of status on public.pact_booking_confirmations for each row execute function public.enqueue_confirmed_pact_email();
drop trigger if exists pact_verified_share_email_outbox on public.pact_shares;
create trigger pact_verified_share_email_outbox after insert or update of status on public.pact_shares for each row execute function public.enqueue_verified_share_email();

revoke all on function public.enqueue_confirmed_pact_email(), public.enqueue_verified_share_email() from public, anon, authenticated;
commit;
