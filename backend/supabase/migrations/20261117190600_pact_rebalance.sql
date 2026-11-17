begin;

create table if not exists public.pact_rebalance_proposals (
  proposal_id uuid primary key default gen_random_uuid(),
  pact_id uuid not null references public.pacts(pact_id) on delete cascade,
  payment_id uuid not null references public.pact_payments(payment_id) on delete restrict,
  created_by uuid not null references auth.users(id),
  status text not null default 'open' check (status in ('open','approved','rejected','applied','expired')),
  before_snapshot jsonb not null check (jsonb_typeof(before_snapshot) = 'object'),
  after_snapshot jsonb not null check (jsonb_typeof(after_snapshot) = 'object'),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pact_id, idempotency_key),
  unique (proposal_id, pact_id),
  foreign key (payment_id, pact_id) references public.pact_payments(payment_id, pact_id) on delete restrict
);

create table if not exists public.pact_rebalance_votes (
  proposal_id uuid not null references public.pact_rebalance_proposals(proposal_id) on delete cascade,
  pact_id uuid not null references public.pacts(pact_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  vote text not null check (vote in ('approve','reject')),
  created_at timestamptz not null default now(),
  primary key (proposal_id, user_id),
  foreign key (proposal_id, pact_id) references public.pact_rebalance_proposals(proposal_id, pact_id) on delete cascade
);

create table if not exists public.pact_rebalance_audit (
  audit_id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.pact_rebalance_proposals(proposal_id) on delete cascade,
  pact_id uuid not null references public.pacts(pact_id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  event_type text not null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

alter table public.pact_rebalance_proposals enable row level security;
alter table public.pact_rebalance_votes enable row level security;
alter table public.pact_rebalance_audit enable row level security;
revoke all on public.pact_rebalance_proposals, public.pact_rebalance_votes, public.pact_rebalance_audit from public, anon, authenticated;
grant select on public.pact_rebalance_proposals, public.pact_rebalance_votes, public.pact_rebalance_audit to authenticated;

create policy "Active members read rebalance proposals" on public.pact_rebalance_proposals for select to authenticated using (exists (select 1 from public.pact_members m where m.pact_id = pact_rebalance_proposals.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));
create policy "Active members read rebalance votes" on public.pact_rebalance_votes for select to authenticated using (exists (select 1 from public.pact_members m where m.pact_id = pact_rebalance_votes.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));
create policy "Active members read rebalance audit" on public.pact_rebalance_audit for select to authenticated using (exists (select 1 from public.pact_members m where m.pact_id = pact_rebalance_audit.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));

create or replace function public.create_pact_rebalance_proposal(p_pact_id uuid, p_payment_id uuid, p_after_snapshot jsonb, p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); payment public.pact_payments; proposal uuid; before_state jsonb;
begin
  if caller is null or not exists (select 1 from public.pact_members where pact_id=p_pact_id and user_id=caller and membership_status='active') then raise exception 'Active Pact membership required' using errcode='42501'; end if;
  if p_after_snapshot is null or jsonb_typeof(p_after_snapshot) <> 'object' or p_idempotency_key is null then raise exception 'Invalid rebalance proposal'; end if;
  select * into payment from public.pact_payments where payment_id=p_payment_id and pact_id=p_pact_id for update;
  if not found then raise exception 'Payment plan is unavailable'; end if;
  if exists (select 1 from public.pact_shares where payment_id=p_payment_id and pact_id=p_pact_id and status in ('paid','refunded')) then raise exception 'Verified contributions cannot be rebalanced'; end if;
  select jsonb_build_object('share_usdc', payment.share_usdc, 'shares_needed', payment.shares_needed) into before_state;
  select proposal_id into proposal from public.pact_rebalance_proposals where pact_id=p_pact_id and idempotency_key=p_idempotency_key;
  if proposal is not null then return proposal; end if;
  insert into public.pact_rebalance_proposals(pact_id,payment_id,created_by,before_snapshot,after_snapshot,idempotency_key) values(p_pact_id,p_payment_id,caller,before_state,p_after_snapshot,p_idempotency_key) returning proposal_id into proposal;
  insert into public.pact_rebalance_audit(proposal_id,pact_id,actor_id,event_type,details) values(proposal,p_pact_id,caller,'created',jsonb_build_object('payment_id',p_payment_id));
  return proposal;
end; $$;

create or replace function public.cast_pact_rebalance_vote(p_proposal_id uuid, p_vote text)
returns public.pact_rebalance_proposals language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); proposal public.pact_rebalance_proposals; eligible integer; approvals integer; rejected boolean;
begin
  if p_vote not in ('approve','reject') then raise exception 'Invalid rebalance vote'; end if;
  select p.* into proposal from public.pact_rebalance_proposals p join public.pact_members m on m.pact_id=p.pact_id and m.user_id=caller and m.membership_status='active' where p.proposal_id=p_proposal_id and p.status='open' for update;
  if not found then raise exception 'Active Pact member and open proposal required' using errcode='42501'; end if;
  insert into public.pact_rebalance_votes(proposal_id,pact_id,user_id,vote) values(p_proposal_id,proposal.pact_id,caller,p_vote);
  select count(*) into eligible from public.pact_members where pact_id=proposal.pact_id and membership_status='active';
  select count(*) filter (where vote='approve'), bool_or(vote='reject') into approvals,rejected from public.pact_rebalance_votes where proposal_id=p_proposal_id;
  if rejected then update public.pact_rebalance_proposals set status='rejected',updated_at=now() where proposal_id=p_proposal_id;
  elsif approvals=eligible then update public.pact_rebalance_proposals set status='approved',updated_at=now() where proposal_id=p_proposal_id; end if;
  insert into public.pact_rebalance_audit(proposal_id,pact_id,actor_id,event_type,details) values(p_proposal_id,proposal.pact_id,caller,'vote',jsonb_build_object('vote',p_vote));
  select * into proposal from public.pact_rebalance_proposals where proposal_id=p_proposal_id;
  return proposal;
end; $$;

create or replace function public.apply_pact_rebalance_proposal(p_proposal_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); proposal public.pact_rebalance_proposals; eligible integer; approvals integer; paid_count integer;
begin
  select p.* into proposal
  from public.pact_rebalance_proposals p
  join public.pact_members m on m.pact_id=p.pact_id and m.user_id=caller and m.membership_status='active'
  where p.proposal_id=p_proposal_id for update;
  if not found then raise exception 'Active Pact member and rebalance proposal required' using errcode='42501'; end if;
  select count(*) into eligible from public.pact_members where pact_id=proposal.pact_id and membership_status='active';
  select count(*) into approvals from public.pact_rebalance_votes where proposal_id=p_proposal_id and vote='approve';
  if proposal.status <> 'approved' or approvals <> eligible then
    return jsonb_build_object('status','rejected','reason','Unanimous active-member approval is required');
  end if;
  select count(*) into paid_count from public.pact_shares where payment_id=proposal.payment_id and status in ('paid','refunded');
  if paid_count > 0 then
    return jsonb_build_object('status','blocked','reason','Verified or refunded contributions cannot be rewritten','required_schema_change','Create a new payment-plan/share-version with immutable settled shares and explicit unpaid-obligation rows');
  end if;
  return jsonb_build_object('status','blocked','reason','Current PactMoney plans store one equal share_usdc value and cannot safely apply arbitrary custom member allocations','required_schema_change','Add versioned per-member unpaid obligations linked to the rebalance proposal, preserving settled shares');
end; $$;

revoke all on function public.create_pact_rebalance_proposal(uuid,uuid,jsonb,uuid), public.cast_pact_rebalance_vote(uuid,text), public.apply_pact_rebalance_proposal(uuid) from public, anon;
grant execute on function public.create_pact_rebalance_proposal(uuid,uuid,jsonb,uuid), public.cast_pact_rebalance_vote(uuid,text), public.apply_pact_rebalance_proposal(uuid) to authenticated;
commit;
