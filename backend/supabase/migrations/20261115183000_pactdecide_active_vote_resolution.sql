begin;

create or replace function public.cast_pact_decision_vote(p_decision_id uuid, p_vote text)
returns public.pact_decisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  d public.pact_decisions;
  total integer;
  approvals integer;
  rejects integer;
  remaining integer;
  is_host boolean;
begin
  if p_vote is null or p_vote not in ('approve','reject') then
    raise exception 'Invalid vote';
  end if;

  select d0.* into d
  from public.pact_decisions d0
  join public.pact_members m
    on m.pact_id = d0.pact_id
   and m.user_id = caller
   and m.membership_status = 'active'
  where d0.decision_id = p_decision_id
  for update of d0;

  if not found then
    raise exception 'Active Pact membership required' using errcode = '42501';
  end if;
  if d.status <> 'open' then
    raise exception 'Decision is closed';
  end if;

  select exists (
    select 1 from public.pact_members
    where pact_id = d.pact_id and user_id = caller
      and role = 'host' and membership_status = 'active'
  ) into is_host;

  if d.approval_rule = 'host' and not is_host then
    raise exception 'Only the active host may vote on this decision' using errcode = '42501';
  end if;

  insert into public.pact_decision_votes(decision_id, user_id, vote)
  values (p_decision_id, caller, p_vote);

  select
    count(*) filter (where v.vote = 'approve'),
    count(*) filter (where v.vote = 'reject')
  into approvals, rejects
  from public.pact_decision_votes v
  join public.pact_members m
    on m.pact_id = d.pact_id
   and m.user_id = v.user_id
   and m.membership_status = 'active'
  where v.decision_id = p_decision_id;

  select count(*) into total
  from public.pact_members
  where pact_id = d.pact_id and membership_status = 'active';

  remaining := total - approvals - rejects;

  if d.approval_rule = 'host' and p_vote = 'approve' then
    update public.pact_decisions set status = 'approved'
    where decision_id = p_decision_id returning * into d;
  elsif d.approval_rule = 'host' and p_vote = 'reject' then
    update public.pact_decisions set status = 'rejected'
    where decision_id = p_decision_id returning * into d;
  elsif d.approval_rule = 'unanimous' and rejects > 0 then
    update public.pact_decisions set status = 'rejected'
    where decision_id = p_decision_id returning * into d;
  elsif d.approval_rule = 'unanimous' and approvals = total then
    update public.pact_decisions set status = 'approved'
    where decision_id = p_decision_id returning * into d;
  elsif d.approval_rule = 'majority' and approvals > total / 2 then
    update public.pact_decisions set status = 'approved'
    where decision_id = p_decision_id returning * into d;
  elsif d.approval_rule = 'majority' and approvals + remaining <= total / 2 then
    update public.pact_decisions set status = 'rejected'
    where decision_id = p_decision_id returning * into d;
  end if;

  return d;
end;
$$;

create or replace function public.get_pact_decision_counts(p_pact_id uuid)
returns table(decision_id uuid, approve_count bigint, reject_count bigint, eligible_count bigint)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.pact_members
    where pact_id = p_pact_id and user_id = auth.uid() and membership_status = 'active'
  ) then
    raise exception 'Active Pact membership required' using errcode = '42501';
  end if;

  return query
  select
    d.decision_id,
    count(*) filter (where v.vote = 'approve' and m.user_id is not null),
    count(*) filter (where v.vote = 'reject' and m.user_id is not null),
    (select count(*) from public.pact_members m2
     where m2.pact_id = p_pact_id and m2.membership_status = 'active')
  from public.pact_decisions d
  left join public.pact_decision_votes v on v.decision_id = d.decision_id
  left join public.pact_members m
    on m.pact_id = d.pact_id
   and m.user_id = v.user_id
   and m.membership_status = 'active'
  where d.pact_id = p_pact_id
  group by d.decision_id;
end;
$$;

commit;
