begin;

create table if not exists public.pact_payment_obligations (
  obligation_id uuid primary key default gen_random_uuid(),
  payment_id uuid not null,
  pact_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  allocation_version integer not null check (allocation_version > 0),
  amount_usdc numeric(30,6) not null check (amount_usdc > 0),
  status text not null default 'owed' check (status in ('owed','paid','refunded')),
  source_share_id uuid references public.pact_shares(share_id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (payment_id, allocation_version, user_id),
  foreign key (payment_id, pact_id) references public.pact_payments(payment_id, pact_id) on delete cascade
);

alter table public.pact_payment_obligations enable row level security;
revoke all on public.pact_payment_obligations from public, anon, authenticated;
grant select on public.pact_payment_obligations to authenticated;
create policy "Active members read payment obligations" on public.pact_payment_obligations for select to authenticated using (exists (select 1 from public.pact_members m where m.pact_id=pact_payment_obligations.pact_id and m.user_id=(select auth.uid()) and m.membership_status='active'));

insert into public.pact_payment_obligations(payment_id,pact_id,user_id,allocation_version,amount_usdc,status,source_share_id)
select s.payment_id,s.pact_id,s.user_id,1,s.amount_usdc,s.status,s.share_id from public.pact_shares s
on conflict (payment_id,allocation_version,user_id) do nothing;

create or replace function public.sync_pact_payment_obligation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.pact_payment_obligations(payment_id,pact_id,user_id,allocation_version,amount_usdc,status,source_share_id)
    values (new.payment_id,new.pact_id,new.user_id,coalesce((select max(o.allocation_version) from public.pact_payment_obligations o where o.payment_id=new.payment_id),1),new.amount_usdc,new.status,new.share_id)
    on conflict (payment_id,allocation_version,user_id) do nothing;
  else
    update public.pact_payment_obligations set status=new.status,source_share_id=new.share_id
    where payment_id=new.payment_id and user_id=new.user_id and allocation_version=(select max(o.allocation_version) from public.pact_payment_obligations o where o.payment_id=new.payment_id);
  end if;
  return new;
end; $$;

drop trigger if exists pact_share_obligation_sync on public.pact_shares;
create trigger pact_share_obligation_sync after insert or update of amount_usdc,status on public.pact_shares for each row execute function public.sync_pact_payment_obligation();

create or replace function public.get_pact_payment_obligation_status(p_pact_id uuid)
returns table(payment_id uuid,pact_id uuid,user_id uuid,amount_usdc numeric,status text,allocation_version integer,source_share_id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.pact_members where pact_id=p_pact_id and user_id=auth.uid() and membership_status='active') then raise exception 'Active Pact membership required' using errcode='42501'; end if;
  return query select o.payment_id,o.pact_id,o.user_id,o.amount_usdc,o.status,o.allocation_version,o.source_share_id
  from public.pact_payment_obligations o
  where o.pact_id=p_pact_id and o.allocation_version=(select max(latest.allocation_version) from public.pact_payment_obligations latest where latest.payment_id=o.payment_id)
  order by o.user_id;
end; $$;

create or replace function public.apply_pact_rebalance_proposal(p_proposal_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); proposal public.pact_rebalance_proposals; payment public.pact_payments; eligible integer; approvals integer; current_version integer; next_version integer; allocations jsonb; item jsonb; item_user uuid; item_amount numeric; total numeric := 0; paid_total numeric := 0; active_count integer; allocation_count integer; duplicate_count integer;
begin
  select p.* into proposal from public.pact_rebalance_proposals p join public.pact_members m on m.pact_id=p.pact_id and m.user_id=caller and m.membership_status='active' where p.proposal_id=p_proposal_id for update;
  if not found then raise exception 'Active Pact member and rebalance proposal required' using errcode='42501'; end if;
  if proposal.status = 'applied' then return jsonb_build_object('status','applied','proposal_id',p_proposal_id); end if;
  select * into payment from public.pact_payments where payment_id=proposal.payment_id and pact_id=proposal.pact_id for update;
  if not found then return jsonb_build_object('status','conflict','reason','Funding plan no longer exists'); end if;
  select count(*) into eligible from public.pact_members where pact_id=proposal.pact_id and membership_status='active';
  select count(*) into approvals from public.pact_rebalance_votes where proposal_id=p_proposal_id and vote='approve';
  if proposal.status <> 'approved' or approvals <> eligible then return jsonb_build_object('status','rejected','reason','Unanimous active-member approval is required'); end if;
  current_version := coalesce((proposal.after_snapshot->>'allocation_version')::integer,0);
  select max(o.allocation_version) into current_version from public.pact_payment_obligations o where o.payment_id=payment.payment_id;
  if coalesce((proposal.after_snapshot->>'base_version')::integer,current_version) <> current_version then return jsonb_build_object('status','conflict','reason','Rebalance proposal is stale','current_version',current_version); end if;
  allocations := proposal.after_snapshot->'allocations';
  if allocations is null or jsonb_typeof(allocations) <> 'array' then return jsonb_build_object('status','blocked','reason','A versioned allocations array is required'); end if;
  select count(*) into active_count from public.pact_members where pact_id=proposal.pact_id and membership_status='active';
  select count(*) into allocation_count from jsonb_array_elements(allocations);
  select count(distinct (value->>'user_id')::uuid) into duplicate_count from jsonb_array_elements(allocations);
  if allocation_count <> active_count or duplicate_count <> allocation_count then return jsonb_build_object('status','conflict','reason','Allocations must contain each active member exactly once'); end if;
  for item in select value from jsonb_array_elements(allocations) loop
    if (item->>'user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return jsonb_build_object('status','blocked','reason','Allocation contains an invalid member ID'); end if;
    item_user := (item->>'user_id')::uuid; item_amount := (item->>'amount_usdc')::numeric;
    if item_amount is null or item_amount <= 0 or not exists (select 1 from public.pact_members where pact_id=proposal.pact_id and user_id=item_user and membership_status='active') then return jsonb_build_object('status','conflict','reason','Allocation contains an inactive member or invalid amount'); end if;
    total := total + item_amount;
  end loop;
  if total <> payment.share_usdc * payment.shares_needed then return jsonb_build_object('status','conflict','reason','Allocation total does not reconcile to the funding plan'); end if;
  select coalesce(sum(amount_usdc),0) into paid_total from public.pact_payment_obligations where payment_id=payment.payment_id and status in ('paid','refunded');
  if exists (select 1 from public.pact_payment_obligations o where o.payment_id=payment.payment_id and o.status in ('paid','refunded') and not exists (select 1 from jsonb_array_elements(allocations) a where (a->>'user_id')::uuid=o.user_id and (a->>'amount_usdc')::numeric=o.amount_usdc)) then return jsonb_build_object('status','conflict','reason','Settled contribution amounts cannot change'); end if;
  next_version := current_version + 1;
  for item in select value from jsonb_array_elements(allocations) loop
    item_user := (item->>'user_id')::uuid; item_amount := (item->>'amount_usdc')::numeric;
    insert into public.pact_payment_obligations(payment_id,pact_id,user_id,allocation_version,amount_usdc,status,source_share_id)
    select payment.payment_id,payment.pact_id,item_user,next_version,item_amount,coalesce(o.status,'owed'),o.source_share_id from public.pact_payment_obligations o where o.payment_id=payment.payment_id and o.allocation_version=current_version and o.user_id=item_user
    on conflict do nothing;
  end loop;
  update public.pact_rebalance_proposals set status='applied',updated_at=now(),after_snapshot=jsonb_set(proposal.after_snapshot,'{allocation_version}',to_jsonb(next_version),true) where proposal_id=p_proposal_id;
  insert into public.pact_rebalance_audit(proposal_id,pact_id,actor_id,event_type,details) values(p_proposal_id,proposal.pact_id,caller,'applied',jsonb_build_object('allocation_version',next_version,'paid_total',paid_total));
  return jsonb_build_object('status','applied','proposal_id',p_proposal_id,'allocation_version',next_version);
end; $$;

revoke all on function public.get_pact_payment_obligation_status(uuid), public.apply_pact_rebalance_proposal(uuid) from public, anon;
grant execute on function public.get_pact_payment_obligation_status(uuid), public.apply_pact_rebalance_proposal(uuid) to authenticated;
commit;
