begin;

alter table public.pact_bookings add column if not exists request_key uuid;
create unique index if not exists pact_bookings_request_key_idx on public.pact_bookings(request_key) where request_key is not null;
create unique index if not exists pact_booking_proposals_fingerprint_idx on public.pact_booking_proposals(booking_id, fingerprint);

create or replace function public.create_pact_booking_idempotent(p_pact_id uuid, p_category text, p_requirements jsonb, p_guest_count integer, p_budget_cents bigint, p_currency text, p_request_key uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); result uuid;
begin
  if caller is null or not exists (select 1 from public.pact_members where pact_id=p_pact_id and user_id=caller and membership_status='active') then raise exception 'Active Pact membership required' using errcode='42501'; end if;
  if p_request_key is null or p_category is null or p_category not in ('hotel','flight','event') or p_requirements is null or jsonb_typeof(p_requirements) <> 'object' or p_guest_count is null or p_guest_count < 1 then raise exception 'Invalid booking request'; end if;
  select booking_id into result from public.pact_bookings where request_key=p_request_key and pact_id=p_pact_id and created_by=caller;
  if result is not null then return result; end if;
  insert into public.pact_bookings(pact_id,created_by,category,requirements,guest_count,budget_cents,currency,request_key) values(p_pact_id,caller,p_category,p_requirements,p_guest_count,p_budget_cents,upper(coalesce(nullif(trim(p_currency),''),'USD')),p_request_key) returning booking_id into result;
  return result;
end; $$;

create or replace function public.create_pact_booking_proposal(p_booking_id uuid, p_provider_ref text, p_option jsonb, p_total_cents bigint, p_currency text, p_quote_expires_at timestamptz, p_fingerprint text) returns uuid language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); booking public.pact_bookings; result uuid; version integer;
begin
  select b.* into booking from public.pact_bookings b join public.pact_members m on m.pact_id=b.pact_id and m.user_id=caller and m.membership_status='active' where b.booking_id=p_booking_id for update;
  if not found then raise exception 'Active Pact membership required' using errcode='42501'; end if;
  if p_option is null or jsonb_typeof(p_option) <> 'object' or p_provider_ref is null or trim(p_provider_ref)='' or p_total_cents is null or p_total_cents <= 0 or p_quote_expires_at is null or p_quote_expires_at <= now() or p_fingerprint is null or trim(p_fingerprint)='' then raise exception 'Invalid booking proposal'; end if;
  select proposal_id into result from public.pact_booking_proposals where booking_id=p_booking_id and fingerprint=trim(p_fingerprint);
  if result is not null then return result; end if;
  select coalesce(max(proposal_version),0)+1 into version from public.pact_booking_proposals where booking_id=p_booking_id;
  insert into public.pact_booking_proposals(booking_id,proposal_version,provider_ref,option,total_cents,currency,quote_expires_at,fingerprint,created_by) values(p_booking_id,version,trim(p_provider_ref),p_option,p_total_cents,upper(coalesce(nullif(trim(p_currency),''),'USD')),p_quote_expires_at,trim(p_fingerprint),caller) returning proposal_id into result;
  insert into public.pact_booking_required_members(proposal_id,user_id) select result,user_id from public.pact_members where pact_id=booking.pact_id and membership_status='active';
  update public.pact_bookings set status='awaiting_booking_approval',updated_at=now() where booking_id=p_booking_id;
  return result;
end; $$;

create or replace function public.cancel_pact_booking(p_booking_id uuid) returns public.pact_bookings language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); result public.pact_bookings;
begin
  select b.* into result from public.pact_bookings b join public.pact_members m on m.pact_id=b.pact_id and m.user_id=caller and m.role='host' and m.membership_status='active' where b.booking_id=p_booking_id for update;
  if not found then raise exception 'Only the active Pact host can cancel this booking' using errcode='42501'; end if;
  if result.status in ('demo_confirmed','cancelled') then return result; end if;
  if result.status in ('awaiting_funding','funded','awaiting_host_confirmation','booking_pending') then raise exception 'Cancel the associated PactMoney plan through its authorized refund flow first'; end if;
  update public.pact_bookings set status='cancelled',updated_at=now() where booking_id=p_booking_id returning * into result;
  return result;
end; $$;

revoke all on function public.create_pact_booking_idempotent(uuid,text,jsonb,integer,bigint,text,uuid), public.cancel_pact_booking(uuid) from public, anon;
grant execute on function public.create_pact_booking_idempotent(uuid,text,jsonb,integer,bigint,text,uuid), public.cancel_pact_booking(uuid) to authenticated;

commit;
