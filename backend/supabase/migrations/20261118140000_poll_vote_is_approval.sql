-- A vote is your approval. A poll decides itself as soon as more than half the group has ticked the same option:
-- no separate Approve. Everyone who voted for the winner is then counted as approving the plan, so nobody approves
-- the same thing twice. Only people with a wallet are counted, because the split needs one to include them; anyone
-- else still taps Approve once, which sets their wallet up.
begin;

alter table public.pact_polls add column if not exists winner_key text;

-- Called right after a vote. If an option now has a majority, the poll closes on it and its key comes back. Only the
-- first caller gets the key (the row is locked and closed), so two people ticking at once can't add it twice.
create or replace function public.decide_pact_poll(p_poll_id uuid)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare caller uuid := auth.uid(); poll public.pact_polls; people integer; winner text;
begin
  select * into poll from public.pact_polls where poll_id = p_poll_id for update;
  if poll.poll_id is null or caller is null or not exists (
    select 1 from public.pact_members where pact_id = poll.pact_id and user_id = caller and membership_status = 'active'
  ) then
    raise exception 'Only people in this pact can vote' using errcode = '42501';
  end if;
  if poll.status <> 'open' then return null; end if;
  select count(*) into people from public.pact_members where pact_id = poll.pact_id and membership_status = 'active';
  select v.option_key into winner
  from public.pact_poll_votes v
  join public.pact_members m on m.pact_id = poll.pact_id and m.user_id = v.user_id and m.membership_status = 'active'
  where v.poll_id = p_poll_id
  group by v.option_key having count(*) * 2 > people
  limit 1;
  if winner is null then return null; end if;
  update public.pact_polls set status = 'closed', winner_key = winner where poll_id = p_poll_id;
  return winner;
end; $$;
revoke all on function public.decide_pact_poll(uuid) from public, anon;
grant execute on function public.decide_pact_poll(uuid) to authenticated;

create or replace function public.approve_from_poll(p_decision_id uuid, p_poll_id uuid, p_option_key text)
returns public.pact_decisions language plpgsql volatile security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  d public.pact_decisions;
  poll public.pact_polls;
  total integer; approvals integer; rejects integer; remaining integer;
begin
  select * into d from public.pact_decisions where decision_id = p_decision_id for update;
  select * into poll from public.pact_polls where poll_id = p_poll_id;
  if d.decision_id is null or poll.poll_id is null or d.pact_id <> poll.pact_id then
    raise exception 'That vote and plan are not in the same pact';
  end if;
  -- Anyone in the pact can finish it once the poll has decided on this option; otherwise only the coordinator.
  if caller is null or not exists (
    select 1 from public.pact_members where pact_id = d.pact_id and user_id = caller and membership_status = 'active'
      and (role = 'host' or poll.winner_key = p_option_key)
  ) then
    raise exception 'Only the coordinator can do this' using errcode = '42501';
  end if;
  if d.status <> 'open' then return d; end if;

  insert into public.pact_decision_votes (decision_id, user_id, vote)
  select p_decision_id, v.user_id, 'approve'
  from public.pact_poll_votes v
  join public.pact_members m on m.pact_id = d.pact_id and m.user_id = v.user_id and m.membership_status = 'active'
  join public.wallets w on w.user_id = v.user_id
  where v.poll_id = p_poll_id and v.option_key = p_option_key
  on conflict (decision_id, user_id) do nothing;

  -- Same outcome rules as cast_pact_decision_vote.
  select count(*) filter (where v.vote = 'approve'), count(*) filter (where v.vote = 'reject')
  into approvals, rejects
  from public.pact_decision_votes v
  join public.pact_members m on m.pact_id = d.pact_id and m.user_id = v.user_id and m.membership_status = 'active'
  where v.decision_id = p_decision_id;
  select count(*) into total from public.pact_members where pact_id = d.pact_id and membership_status = 'active';
  remaining := total - approvals - rejects;

  if d.approval_rule = 'unanimous' and rejects > 0 then
    update public.pact_decisions set status = 'rejected' where decision_id = p_decision_id returning * into d;
  elsif d.approval_rule = 'unanimous' and approvals = total then
    update public.pact_decisions set status = 'approved' where decision_id = p_decision_id returning * into d;
  elsif d.approval_rule = 'majority' and approvals > total / 2 then
    update public.pact_decisions set status = 'approved' where decision_id = p_decision_id returning * into d;
  elsif d.approval_rule = 'majority' and approvals + remaining <= total / 2 then
    update public.pact_decisions set status = 'rejected' where decision_id = p_decision_id returning * into d;
  end if;
  return d;
end; $$;

revoke all on function public.approve_from_poll(uuid, uuid, text) from public, anon;
grant execute on function public.approve_from_poll(uuid, uuid, text) to authenticated;
commit;
