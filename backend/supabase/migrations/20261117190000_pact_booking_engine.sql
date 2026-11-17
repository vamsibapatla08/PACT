begin;

create table public.pact_bookings (
  booking_id uuid primary key default gen_random_uuid(),
  pact_id uuid not null references public.pacts(pact_id) on delete cascade,
  created_by uuid not null references auth.users(id),
  category text not null check (category in ('hotel','flight','event')),
  requirements jsonb not null default '{}'::jsonb,
  guest_count integer not null check (guest_count > 0),
  budget_cents bigint check (budget_cents is null or budget_cents > 0),
  currency text not null default 'USD',
  status text not null default 'draft' check (status in ('draft','awaiting_booking_approval','awaiting_split_approval','awaiting_funding','funded','awaiting_host_confirmation','booking_pending','demo_confirmed','failed','cancelled','expired')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.pact_booking_proposals (
  proposal_id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.pact_bookings(booking_id) on delete cascade,
  proposal_version integer not null check (proposal_version > 0),
  provider_ref text not null,
  option jsonb not null,
  total_cents bigint not null check (total_cents > 0),
  currency text not null default 'USD',
  quote_expires_at timestamptz not null,
  fingerprint text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (booking_id, proposal_version),
  unique (booking_id, proposal_version, fingerprint)
);

create table public.pact_booking_required_members (
  proposal_id uuid not null references public.pact_booking_proposals(proposal_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (proposal_id, user_id)
);

create table public.pact_booking_approvals (
  proposal_id uuid not null references public.pact_booking_proposals(proposal_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  decision text not null check (decision in ('approve','reject')),
  created_at timestamptz not null default now(),
  primary key (proposal_id, user_id)
);

create table public.pact_booking_splits (
  split_id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.pact_bookings(booking_id) on delete cascade,
  proposal_id uuid not null references public.pact_booking_proposals(proposal_id) on delete restrict,
  split_version integer not null check (split_version > 0),
  split_type text not null check (split_type in ('equal','custom')),
  total_cents bigint not null check (total_cents > 0),
  currency text not null default 'USD',
  status text not null default 'open' check (status in ('open','approved','rejected')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (booking_id, split_version)
);

create table public.pact_booking_split_items (
  split_id uuid not null references public.pact_booking_splits(split_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  primary key (split_id, user_id)
);

create table public.pact_booking_split_approvals (
  split_id uuid not null references public.pact_booking_splits(split_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  decision text not null check (decision in ('approve','reject')),
  created_at timestamptz not null default now(),
  primary key (split_id, user_id)
);

create table public.pact_booking_attempts (
  attempt_id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.pact_bookings(booking_id) on delete cascade,
  proposal_id uuid not null references public.pact_booking_proposals(proposal_id) on delete restrict,
  idempotency_key uuid not null,
  host_user_id uuid not null references auth.users(id),
  attempt_status text not null default 'pending' check (attempt_status in ('pending','succeeded','failed')),
  provider_request jsonb not null default '{}'::jsonb,
  provider_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id, idempotency_key)
);

create table public.pact_booking_confirmations (
  confirmation_id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.pact_bookings(booking_id) on delete cascade,
  attempt_id uuid not null unique references public.pact_booking_attempts(attempt_id) on delete restrict,
  provider_type text not null default 'demo',
  demo_confirmation_code text not null unique,
  details jsonb not null default '{}'::jsonb,
  simulated boolean not null default true,
  status text not null check (status in ('confirmed','failed','cancelled')),
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.pact_booking_notifications (
  notification_id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.pact_bookings(booking_id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  notification_type text not null,
  delivery_status text not null default 'pending' check (delivery_status in ('pending','sent','failed')),
  provider_ack text,
  created_at timestamptz not null default now()
);

create index pact_bookings_pact_idx on public.pact_bookings(pact_id, updated_at desc);
create index pact_booking_proposals_booking_idx on public.pact_booking_proposals(booking_id, proposal_version desc);
create index pact_booking_approvals_proposal_idx on public.pact_booking_approvals(proposal_id);
create index pact_booking_confirmations_booking_idx on public.pact_booking_confirmations(booking_id, confirmed_at desc);

alter table public.pact_bookings enable row level security;
alter table public.pact_booking_proposals enable row level security;
alter table public.pact_booking_required_members enable row level security;
alter table public.pact_booking_approvals enable row level security;
alter table public.pact_booking_splits enable row level security;
alter table public.pact_booking_split_items enable row level security;
alter table public.pact_booking_split_approvals enable row level security;
alter table public.pact_booking_attempts enable row level security;
alter table public.pact_booking_confirmations enable row level security;
alter table public.pact_booking_notifications enable row level security;

revoke all on public.pact_bookings, public.pact_booking_proposals, public.pact_booking_required_members, public.pact_booking_approvals, public.pact_booking_splits, public.pact_booking_split_items, public.pact_booking_split_approvals, public.pact_booking_attempts, public.pact_booking_confirmations, public.pact_booking_notifications from public, anon, authenticated;
grant select on public.pact_bookings, public.pact_booking_proposals, public.pact_booking_required_members, public.pact_booking_approvals, public.pact_booking_splits, public.pact_booking_split_items, public.pact_booking_split_approvals, public.pact_booking_attempts, public.pact_booking_confirmations, public.pact_booking_notifications to authenticated;

create policy "Active members read bookings" on public.pact_bookings for select to authenticated using (exists (select 1 from public.pact_members m where m.pact_id = pact_bookings.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));
create policy "Active members read booking proposals" on public.pact_booking_proposals for select to authenticated using (exists (select 1 from public.pact_bookings b join public.pact_members m on m.pact_id = b.pact_id where b.booking_id = pact_booking_proposals.booking_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));
create policy "Active members read booking required members" on public.pact_booking_required_members for select to authenticated using (exists (select 1 from public.pact_booking_proposals p join public.pact_bookings b on b.booking_id = p.booking_id join public.pact_members m on m.pact_id = b.pact_id where p.proposal_id = pact_booking_required_members.proposal_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));
create policy "Active members read booking approvals" on public.pact_booking_approvals for select to authenticated using (exists (select 1 from public.pact_booking_proposals p join public.pact_bookings b on b.booking_id = p.booking_id join public.pact_members m on m.pact_id = b.pact_id where p.proposal_id = pact_booking_approvals.proposal_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));
create policy "Active members read booking splits" on public.pact_booking_splits for select to authenticated using (exists (select 1 from public.pact_bookings b join public.pact_members m on m.pact_id = b.pact_id where b.booking_id = pact_booking_splits.booking_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));
create policy "Active members read booking split items" on public.pact_booking_split_items for select to authenticated using (exists (select 1 from public.pact_booking_splits s join public.pact_bookings b on b.booking_id = s.booking_id join public.pact_members m on m.pact_id = b.pact_id where s.split_id = pact_booking_split_items.split_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));
create policy "Active members read booking split approvals" on public.pact_booking_split_approvals for select to authenticated using (exists (select 1 from public.pact_booking_splits s join public.pact_bookings b on b.booking_id = s.booking_id join public.pact_members m on m.pact_id = b.pact_id where s.split_id = pact_booking_split_approvals.split_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));
create policy "Active members read booking attempts" on public.pact_booking_attempts for select to authenticated using (exists (select 1 from public.pact_bookings b join public.pact_members m on m.pact_id = b.pact_id where b.booking_id = pact_booking_attempts.booking_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));
create policy "Active members read booking confirmations" on public.pact_booking_confirmations for select to authenticated using (exists (select 1 from public.pact_bookings b join public.pact_members m on m.pact_id = b.pact_id where b.booking_id = pact_booking_confirmations.booking_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));
create policy "Active members read booking notifications" on public.pact_booking_notifications for select to authenticated using (exists (select 1 from public.pact_bookings b join public.pact_members m on m.pact_id = b.pact_id where b.booking_id = pact_booking_notifications.booking_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));

create or replace function public.create_pact_booking(p_pact_id uuid, p_category text, p_requirements jsonb, p_guest_count integer, p_budget_cents bigint default null, p_currency text default 'USD') returns uuid language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); result uuid;
begin
  if caller is null or not exists (select 1 from public.pact_members where pact_id = p_pact_id and user_id = caller and membership_status = 'active') then raise exception 'Active Pact membership required' using errcode = '42501'; end if;
  if p_category not in ('hotel','flight','event') or p_requirements is null or jsonb_typeof(p_requirements) <> 'object' or p_guest_count is null or p_guest_count < 1 then raise exception 'Invalid booking request'; end if;
  insert into public.pact_bookings(pact_id,created_by,category,requirements,guest_count,budget_cents,currency) values (p_pact_id,caller,p_category,p_requirements,p_guest_count,p_budget_cents,upper(coalesce(nullif(trim(p_currency),''),'USD'))) returning booking_id into result;
  return result;
end; $$;

create or replace function public.create_pact_booking_proposal(p_booking_id uuid, p_provider_ref text, p_option jsonb, p_total_cents bigint, p_currency text, p_quote_expires_at timestamptz, p_fingerprint text) returns uuid language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); booking public.pact_bookings; result uuid; version integer;
begin
  select b.* into booking from public.pact_bookings b join public.pact_members m on m.pact_id=b.pact_id and m.user_id=caller and m.membership_status='active' where b.booking_id=p_booking_id for update;
  if not found then raise exception 'Active Pact membership required' using errcode='42501'; end if;
  if p_option is null or jsonb_typeof(p_option) <> 'object' or p_provider_ref is null or trim(p_provider_ref)='' or p_total_cents is null or p_total_cents <= 0 or p_quote_expires_at <= now() or p_fingerprint is null or trim(p_fingerprint)='' then raise exception 'Invalid booking proposal'; end if;
  select coalesce(max(proposal_version),0)+1 into version from public.pact_booking_proposals where booking_id=p_booking_id;
  insert into public.pact_booking_proposals(booking_id,proposal_version,provider_ref,option,total_cents,currency,quote_expires_at,fingerprint,created_by) values(p_booking_id,version,trim(p_provider_ref),p_option,p_total_cents,upper(coalesce(nullif(trim(p_currency),''),'USD')),p_quote_expires_at,trim(p_fingerprint),caller) returning proposal_id into result;
  insert into public.pact_booking_required_members(proposal_id,user_id) select result,user_id from public.pact_members where pact_id=booking.pact_id and membership_status='active';
  update public.pact_bookings set status='awaiting_booking_approval',updated_at=now() where booking_id=p_booking_id;
  return result;
end; $$;

create or replace function public.cast_pact_booking_approval(p_proposal_id uuid, p_decision text) returns public.pact_booking_proposals language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); proposal public.pact_booking_proposals; required_count integer; approval_count integer; rejected boolean;
begin
  if p_decision not in ('approve','reject') then raise exception 'Invalid booking approval'; end if;
  select p.* into proposal from public.pact_booking_proposals p join public.pact_booking_required_members r on r.proposal_id=p.proposal_id and r.user_id=caller where p.proposal_id=p_proposal_id for update;
  if not found then raise exception 'Eligible booking member required' using errcode='42501'; end if;
  insert into public.pact_booking_approvals(proposal_id,user_id,decision) values(p_proposal_id,caller,p_decision);
  select count(*) into required_count from public.pact_booking_required_members where proposal_id=p_proposal_id;
  select count(*) filter (where decision='approve'), bool_or(decision='reject') into approval_count,rejected from public.pact_booking_approvals where proposal_id=p_proposal_id;
  if rejected then update public.pact_bookings set status='draft',updated_at=now() where booking_id=proposal.booking_id; elsif approval_count=required_count then update public.pact_bookings set status='awaiting_split_approval',updated_at=now() where booking_id=proposal.booking_id; end if;
  return proposal;
end; $$;

revoke all on function public.create_pact_booking(uuid,text,jsonb,integer,bigint,text), public.create_pact_booking_proposal(uuid,text,jsonb,bigint,text,timestamptz,text), public.cast_pact_booking_approval(uuid,text) from public, anon, authenticated;
grant execute on function public.create_pact_booking_proposal(uuid,text,jsonb,bigint,text,timestamptz,text), public.cast_pact_booking_approval(uuid,text) to authenticated;

commit;
