-- Votes now need everyone: a poll decides only when every active member has picked the same option.
-- And a decided vote can be reopened to change your pick, until the group's money is being collected.

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
  group by v.option_key having count(*) = people
  limit 1;
  if winner is null then return null; end if;
  update public.pact_polls set status = 'closed', winner_key = winner where poll_id = p_poll_id;
  return winner;
end; $$;
revoke all on function public.decide_pact_poll(uuid) from public, anon;
grant execute on function public.decide_pact_poll(uuid) to authenticated;

-- Change your pick on a decided vote. The vote opens again with your new pick, and the item it had put on the plan
-- comes off, so the group agrees again. Not once the split is set up: by then money is moving.
create or replace function public.change_pact_poll_vote(p_poll_id uuid, p_option_key text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare caller uuid := auth.uid(); poll public.pact_polls; old_name text;
begin
  select * into poll from public.pact_polls where poll_id = p_poll_id for update;
  if poll.poll_id is null or caller is null or not exists (
    select 1 from public.pact_members where pact_id = poll.pact_id and user_id = caller and membership_status = 'active'
  ) then
    raise exception 'Only people in this pact can vote' using errcode = '42501';
  end if;
  if not exists (select 1 from jsonb_array_elements(poll.options) o where o->>'key' = p_option_key) then
    raise exception 'That option is not in this vote';
  end if;
  if exists (select 1 from public.pact_payments where pact_id = poll.pact_id) then
    raise exception 'The money is already being collected, so this vote is locked';
  end if;
  if poll.status <> 'open' and exists (select 1 from public.pact_decisions where pact_id = poll.pact_id and status = 'open') then
    raise exception 'The plan is up for approval, so this vote is locked. Change the plan first';
  end if;

  if poll.status <> 'open' then
    select o->>'name' into old_name from jsonb_array_elements(poll.options) o where o->>'key' = poll.winner_key;
    if old_name is not null then
      delete from public.pact_items where pact_id = poll.pact_id and lower(trim(title)) = lower(trim(old_name));
    end if;
    update public.pact_polls set status = 'open', winner_key = null where poll_id = p_poll_id;
  end if;

  insert into public.pact_poll_votes (poll_id, user_id, option_key) values (p_poll_id, caller, p_option_key)
  on conflict (poll_id, user_id) do update set option_key = excluded.option_key, created_at = now();
end; $$;
revoke all on function public.change_pact_poll_vote(uuid, text) from public, anon;
grant execute on function public.change_pact_poll_vote(uuid, text) to authenticated;
