-- Additive PactPilot action-engine foundation.
-- This migration stores proposals and delivery requests only; it does not
-- authorize transfers, release funds, confirm bookings, or send email.

begin;

create table if not exists public.pact_ai_operations (
  operation_id uuid primary key default gen_random_uuid(),
  pact_id uuid not null references public.pacts(pact_id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  request_text text not null check (btrim(request_text) <> '' and char_length(request_text) <= 2000),
  status text not null default 'draft' check (status in ('draft','awaiting_confirmation','awaiting_approval','executing','completed','failed','cancelled')),
  plan jsonb not null default '{}'::jsonb check (jsonb_typeof(plan) = 'object'),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pact_id, idempotency_key)
);

create table if not exists public.pact_action_cards (
  card_id uuid primary key default gen_random_uuid(),
  pact_id uuid not null references public.pacts(pact_id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  action_type text not null check (action_type in ('plan','poll','booking','split','rebalance','payment','booking_receipt','payment_receipt')),
  state text not null default 'draft' check (state in ('draft','awaiting approval','approved','rejected','pending verification','completed','failed')),
  title text not null check (btrim(title) <> '' and char_length(title) <= 240),
  description text not null default '' check (char_length(description) <= 4000),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  target_id uuid,
  operation_id uuid references public.pact_ai_operations(operation_id) on delete set null,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pact_id, idempotency_key)
);

create table if not exists public.pact_ai_audit_events (
  audit_id uuid primary key default gen_random_uuid(),
  pact_id uuid not null references public.pacts(pact_id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid references public.pact_ai_operations(operation_id) on delete set null,
  action_type text not null,
  outcome text not null check (outcome in ('requested','approved','rejected','completed','failed')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create table if not exists public.pact_email_outbox (
  email_id uuid primary key default gen_random_uuid(),
  pact_id uuid not null references public.pacts(pact_id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  email_type text not null check (email_type in ('demo_itinerary','verified_payment_receipt')),
  entity_id uuid not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (email_type, entity_id, recipient_user_id)
);

create index if not exists pact_ai_operations_pact_updated_idx on public.pact_ai_operations(pact_id, updated_at desc);
create index if not exists pact_action_cards_pact_updated_idx on public.pact_action_cards(pact_id, updated_at desc);
create index if not exists pact_ai_audit_events_pact_created_idx on public.pact_ai_audit_events(pact_id, created_at desc);
create index if not exists pact_email_outbox_pending_idx on public.pact_email_outbox(status, next_attempt_at);

alter table public.pact_ai_operations enable row level security;
alter table public.pact_action_cards enable row level security;
alter table public.pact_ai_audit_events enable row level security;
alter table public.pact_email_outbox enable row level security;

revoke all on public.pact_ai_operations, public.pact_action_cards, public.pact_ai_audit_events, public.pact_email_outbox from public, anon, authenticated;
grant select on public.pact_ai_operations, public.pact_action_cards, public.pact_ai_audit_events, public.pact_email_outbox to authenticated;

create policy "Active members read AI operations" on public.pact_ai_operations for select to authenticated using (exists (select 1 from public.pact_members m where m.pact_id = pact_ai_operations.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));
create policy "Active members read action cards" on public.pact_action_cards for select to authenticated using (exists (select 1 from public.pact_members m where m.pact_id = pact_action_cards.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));
create policy "Active members read AI audits" on public.pact_ai_audit_events for select to authenticated using (exists (select 1 from public.pact_members m where m.pact_id = pact_ai_audit_events.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));
create policy "Members read own email outbox" on public.pact_email_outbox for select to authenticated using (recipient_user_id = (select auth.uid()) and exists (select 1 from public.pact_members m where m.pact_id = pact_email_outbox.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));

create or replace function public.create_pact_ai_operation(
  p_pact_id uuid,
  p_request_text text,
  p_plan jsonb,
  p_idempotency_key uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  result uuid;
begin
  if caller is null or not exists (select 1 from public.pact_members where pact_id = p_pact_id and user_id = caller and membership_status = 'active') then
    raise exception 'Active Pact membership required' using errcode = '42501';
  end if;
  if p_request_text is null or btrim(p_request_text) = '' or char_length(p_request_text) > 2000 or p_plan is null or jsonb_typeof(p_plan) <> 'object' or p_idempotency_key is null then
    raise exception 'Invalid AI operation';
  end if;
  select operation_id into result from public.pact_ai_operations where pact_id = p_pact_id and idempotency_key = p_idempotency_key;
  if result is not null then return result; end if;
  insert into public.pact_ai_operations(pact_id, created_by, request_text, status, plan, idempotency_key)
  values (p_pact_id, caller, btrim(p_request_text), 'awaiting_confirmation', p_plan, p_idempotency_key)
  returning operation_id into result;
  insert into public.pact_ai_audit_events(pact_id, actor_id, operation_id, action_type, outcome)
  values (p_pact_id, caller, result, 'ai_operation', 'requested');
  return result;
end;
$$;

create or replace function public.create_pact_action_card(
  p_pact_id uuid,
  p_action_type text,
  p_state text,
  p_title text,
  p_description text,
  p_payload jsonb,
  p_target_id uuid,
  p_operation_id uuid,
  p_idempotency_key uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  result uuid;
begin
  if caller is null or not exists (select 1 from public.pact_members where pact_id = p_pact_id and user_id = caller and membership_status = 'active') then
    raise exception 'Active Pact membership required' using errcode = '42501';
  end if;
  if p_action_type is null or p_action_type not in ('plan','poll','booking','split','rebalance','payment','booking_receipt','payment_receipt') or p_state is null or p_state not in ('draft','awaiting approval','approved','rejected','pending verification','completed','failed') or p_title is null or btrim(p_title) = '' or char_length(p_title) > 240 or p_description is null or char_length(p_description) > 4000 or p_payload is null or jsonb_typeof(p_payload) <> 'object' or p_idempotency_key is null then
    raise exception 'Invalid Pact action card';
  end if;
  if p_action_type in ('poll','booking','split','rebalance','payment','booking_receipt','payment_receipt') and p_target_id is null then
    raise exception 'Action card requires a target record';
  end if;
  if p_action_type = 'poll' and coalesce(p_payload->>'decision_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Poll card must contain a valid decision ID';
  end if;
  if p_action_type = 'poll' and (p_payload->>'decision_id')::uuid is distinct from p_target_id then
    raise exception 'Poll card must reference its decision';
  end if;
  if p_action_type = 'poll' and not exists (select 1 from public.pact_decisions where decision_id=p_target_id and pact_id=p_pact_id) then raise exception 'Decision does not belong to this Pact'; end if;
  if p_action_type = 'booking' and not exists (select 1 from public.pact_bookings where booking_id=p_target_id and pact_id=p_pact_id) then raise exception 'Booking does not belong to this Pact'; end if;
  if p_action_type = 'split' and not exists (select 1 from public.pact_booking_splits s join public.pact_bookings b on b.booking_id=s.booking_id where s.split_id=p_target_id and b.pact_id=p_pact_id) then raise exception 'Split does not belong to this Pact'; end if;
  if p_action_type = 'rebalance' and not exists (select 1 from public.pact_rebalance_proposals where proposal_id=p_target_id and pact_id=p_pact_id) then raise exception 'Rebalance proposal does not belong to this Pact'; end if;
  if p_action_type = 'payment' and not exists (select 1 from public.pact_payments where payment_id=p_target_id and pact_id=p_pact_id) then raise exception 'Payment does not belong to this Pact'; end if;
  if p_action_type = 'booking_receipt' and not exists (select 1 from public.pact_booking_confirmations c join public.pact_bookings b on b.booking_id=c.booking_id where c.confirmation_id=p_target_id and b.pact_id=p_pact_id and c.status='confirmed') then raise exception 'Booking receipt does not belong to a confirmed booking in this Pact'; end if;
  if p_action_type = 'payment_receipt' and not exists (select 1 from public.pact_shares s where s.share_id=p_target_id and s.pact_id=p_pact_id and s.status='paid') then raise exception 'Payment receipt requires a verified paid share in this Pact'; end if;
  if p_operation_id is not null and not exists (select 1 from public.pact_ai_operations where operation_id = p_operation_id and pact_id = p_pact_id) then
    raise exception 'AI operation does not belong to this Pact';
  end if;
  select card_id into result from public.pact_action_cards where pact_id = p_pact_id and idempotency_key = p_idempotency_key;
  if result is not null then return result; end if;
  insert into public.pact_action_cards(pact_id, created_by, action_type, state, title, description, payload, target_id, operation_id, idempotency_key)
  values (p_pact_id, caller, p_action_type, p_state, btrim(p_title), p_description, p_payload, p_target_id, p_operation_id, p_idempotency_key)
  returning card_id into result;
  insert into public.pact_ai_audit_events(pact_id, actor_id, operation_id, action_type, outcome, metadata)
  values (p_pact_id, caller, p_operation_id, p_action_type, 'requested', jsonb_build_object('card_id', result));
  return result;
end;
$$;

create or replace function public.enqueue_pact_email(
  p_pact_id uuid,
  p_email_type text,
  p_entity_id uuid,
  p_payload jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  result uuid;
begin
  if caller is null or not exists (select 1 from public.pact_members where pact_id = p_pact_id and user_id = caller and membership_status = 'active') then
    raise exception 'Active Pact membership required' using errcode = '42501';
  end if;
  if p_email_type is null or p_email_type not in ('demo_itinerary','verified_payment_receipt') or p_entity_id is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid email request';
  end if;
  if p_email_type = 'verified_payment_receipt' and not exists (
    select 1
    from public.pact_shares s
    join public.pact_payments p on p.payment_id = s.payment_id and p.pact_id = s.pact_id
    where s.share_id = p_entity_id and s.pact_id = p_pact_id and s.user_id = caller and s.status = 'paid'
  ) then
    raise exception 'Only a verified personal payment share can produce a receipt';
  end if;
  if p_email_type = 'demo_itinerary' and not exists (
    select 1
    from public.pact_booking_confirmations c
    join public.pact_bookings b on b.booking_id = c.booking_id
    where c.confirmation_id = p_entity_id and b.pact_id = p_pact_id and c.status = 'confirmed'
  ) then
    raise exception 'Only a confirmed Pact booking can produce an itinerary';
  end if;
  select email_id into result from public.pact_email_outbox where email_type = p_email_type and entity_id = p_entity_id and recipient_user_id = caller;
  if result is not null then return result; end if;
  insert into public.pact_email_outbox(pact_id, recipient_user_id, email_type, entity_id, payload)
  values (p_pact_id, caller, p_email_type, p_entity_id, p_payload)
  returning email_id into result;
  return result;
end;
$$;

create or replace function public.begin_pact_ai_operation(p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare operation public.pact_ai_operations;
begin
  select * into operation from public.pact_ai_operations where operation_id = p_operation_id and created_by = auth.uid() and status = 'awaiting_confirmation' for update;
  if not found then raise exception 'Operation is unavailable or already started' using errcode = '42501'; end if;
  update public.pact_ai_operations set status = 'executing', updated_at = now() where operation_id = p_operation_id;
  insert into public.pact_ai_audit_events(pact_id, actor_id, operation_id, action_type, outcome) values (operation.pact_id, auth.uid(), p_operation_id, 'ai_operation', 'approved');
  return operation.plan;
end;
$$;

create or replace function public.finish_pact_ai_operation(p_operation_id uuid, p_status text, p_result jsonb)
returns public.pact_ai_operations language plpgsql security definer set search_path = '' as $$
declare operation public.pact_ai_operations;
begin
  if p_status is null or p_status not in ('completed','failed','cancelled') or p_result is null or jsonb_typeof(p_result) <> 'object' then raise exception 'Invalid operation result'; end if;
  update public.pact_ai_operations set status = p_status, result = p_result, updated_at = now() where operation_id = p_operation_id and created_by = auth.uid() and status = 'executing' returning * into operation;
  if not found then raise exception 'Operation is unavailable or not executing' using errcode = '42501'; end if;
  insert into public.pact_ai_audit_events(pact_id, actor_id, operation_id, action_type, outcome, metadata) values (operation.pact_id, auth.uid(), p_operation_id, 'ai_operation', case when p_status = 'completed' then 'completed' when p_status = 'failed' then 'failed' else 'rejected' end, p_result);
  return operation;
end;
$$;

revoke all on function public.create_pact_ai_operation(uuid,text,jsonb,uuid), public.create_pact_action_card(uuid,text,text,text,text,jsonb,uuid,uuid,uuid), public.enqueue_pact_email(uuid,text,uuid,jsonb), public.begin_pact_ai_operation(uuid), public.finish_pact_ai_operation(uuid,text,jsonb) from public, anon;
grant execute on function public.create_pact_ai_operation(uuid,text,jsonb,uuid), public.create_pact_action_card(uuid,text,text,text,text,jsonb,uuid,uuid,uuid), public.enqueue_pact_email(uuid,text,uuid,jsonb), public.begin_pact_ai_operation(uuid), public.finish_pact_ai_operation(uuid,text,jsonb) to authenticated;

-- Only the server-side email worker may claim and update queued deliveries.
grant select, update on public.pact_email_outbox to service_role;

commit;
