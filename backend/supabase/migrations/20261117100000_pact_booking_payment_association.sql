begin;

create table public.pact_booking_payment_plans (
  association_id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.pact_bookings(booking_id) on delete cascade,
  split_id uuid not null unique references public.pact_booking_splits(split_id) on delete restrict,
  payment_id uuid not null unique,
  pact_id uuid not null references public.pacts(pact_id) on delete cascade,
  proposal_id uuid not null references public.pact_booking_proposals(proposal_id) on delete restrict,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (payment_id, pact_id),
  foreign key (payment_id, pact_id) references public.pact_payments(payment_id, pact_id) on delete restrict
);

alter table public.pact_booking_payment_plans enable row level security;
revoke all on public.pact_booking_payment_plans from public, anon, authenticated;
grant select on public.pact_booking_payment_plans to authenticated;
create policy "Active members read booking payment association" on public.pact_booking_payment_plans for select to authenticated using (exists (select 1 from public.pact_members m where m.pact_id = pact_booking_payment_plans.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));

create or replace function public.associate_pact_booking_payment(p_booking_id uuid, p_split_id uuid, p_payment_id uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); b public.pact_bookings; s public.pact_booking_splits; p public.pact_payments; proposal_id uuid; members_count integer; shares_count integer; paid_amount numeric; result uuid;
begin
  select b0.* into b from public.pact_bookings b0 join public.pact_members m on m.pact_id=b0.pact_id and m.user_id=caller and m.role='host' and m.membership_status='active' where b0.booking_id=p_booking_id for update;
  if not found then raise exception 'Only the active Pact host can associate funding' using errcode='42501'; end if;
  select * into s from public.pact_booking_splits where split_id=p_split_id and booking_id=p_booking_id and status='approved';
  if not found or s.split_type <> 'equal' then raise exception 'Only an approved equal split can be funded'; end if;
  select * into p from public.pact_payments where payment_id=p_payment_id and pact_id=b.pact_id and status='open';
  if not found then raise exception 'Funding plan does not belong to this Pact or is unavailable'; end if;
  select count(*) into members_count from public.pact_booking_split_items where split_id=p_split_id;
  select count(*) into shares_count from public.pact_shares where payment_id=p_payment_id and pact_id=b.pact_id;
  if members_count <> shares_count or p.shares_needed <> members_count then raise exception 'Funding plan members do not match the approved booking split'; end if;
  if exists (select 1 from public.pact_booking_split_items i where i.split_id=p_split_id and not exists (select 1 from public.pact_shares sh where sh.payment_id=p_payment_id and sh.user_id=i.user_id)) then raise exception 'Funding plan members do not match the approved booking split'; end if;
  select sum(amount_cents)::numeric / 100 into paid_amount from public.pact_booking_split_items where split_id=p_split_id;
  if paid_amount <> p.share_usdc * p.shares_needed or exists (select 1 from public.pact_booking_split_items where split_id=p_split_id and amount_cents <> round(p.share_usdc * 100)) then raise exception 'Funding plan amounts do not match the approved equal split'; end if;
  select proposal_id into proposal_id from public.pact_booking_splits where split_id=p_split_id;
  insert into public.pact_booking_payment_plans(booking_id,split_id,payment_id,pact_id,proposal_id,created_by) values(p_booking_id,p_split_id,p_payment_id,b.pact_id,proposal_id,caller) returning association_id into result;
  update public.pact_bookings set status='awaiting_funding', updated_at=now() where booking_id=p_booking_id;
  return result;
exception when unique_violation then
  select association_id into result from public.pact_booking_payment_plans where booking_id=p_booking_id and split_id=p_split_id and payment_id=p_payment_id;
  if result is not null then return result; end if;
  raise exception 'Funding plan is already associated with another booking';
end; $$;

revoke all on function public.associate_pact_booking_payment(uuid,uuid,uuid) from public, anon;
grant execute on function public.associate_pact_booking_payment(uuid,uuid,uuid) to authenticated;

commit;
