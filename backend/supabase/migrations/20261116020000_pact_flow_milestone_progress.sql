begin;

-- Milestones were seeded as pending and never moved. This works out each step
-- from real data, and triggers run it whenever that data changes.
create or replace function public.refresh_pact_milestones(p_pact_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  planned boolean;
  decided boolean;
  funded boolean;
begin
  select exists (select 1 from public.pact_recommendations where pact_id = p_pact_id)
      or exists (select 1 from public.pact_decisions where pact_id = p_pact_id)
    into planned;

  select exists (select 1 from public.pact_decisions where pact_id = p_pact_id and status = 'approved')
    into decided;

  select exists (select 1 from public.pact_payments where pact_id = p_pact_id and status = 'released')
      or exists (
        select 1 from public.pact_payments p
        where p.pact_id = p_pact_id and p.status = 'open'
          and exists (select 1 from public.pact_shares s where s.payment_id = p.payment_id)
          and not exists (select 1 from public.pact_shares s where s.payment_id = p.payment_id and s.status = 'owed')
      )
    into funded;

  update public.pact_milestones
  set status = 'complete', completed_at = coalesce(completed_at, now())
  where pact_id = p_pact_id
    and status <> 'complete'
    and (
      (milestone_kind = 'planning' and planned)
      or (milestone_kind = 'decision' and decided)
      or (milestone_kind = 'funding' and funded)
    );

  -- The first step not yet complete is the one in progress, the rest wait.
  update public.pact_milestones m
  set status = case
    when m.position = (
      select min(position) from public.pact_milestones
      where pact_id = p_pact_id and status <> 'complete'
    ) then 'in_progress'
    else 'pending'
  end
  where m.pact_id = p_pact_id and m.status <> 'complete';
end;
$$;

create or replace function public.refresh_pact_milestones_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_pact_milestones(new.pact_id);
  return null;
end;
$$;

create trigger pact_recommendations_refresh_milestones
after insert on public.pact_recommendations
for each row execute function public.refresh_pact_milestones_trigger();

create trigger pact_decisions_refresh_milestones
after insert or update of status on public.pact_decisions
for each row execute function public.refresh_pact_milestones_trigger();

create trigger pact_payments_refresh_milestones
after insert or update of status on public.pact_payments
for each row execute function public.refresh_pact_milestones_trigger();

create trigger pact_shares_refresh_milestones
after insert or update of status on public.pact_shares
for each row execute function public.refresh_pact_milestones_trigger();

-- Same as before, plus a refresh at the end so pacts made before this
-- migration catch up the next time someone opens them.
create or replace function public.seed_pact_milestones(p_pact_id uuid, p_pact_type text default 'general') returns void language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); keys text[];
begin
  if not exists (select 1 from public.pact_members where pact_id = p_pact_id and user_id = caller and membership_status = 'active') then raise exception 'Active Pact membership required' using errcode = '42501'; end if;
  keys := case lower(coalesce(p_pact_type, 'general')) when 'travel' then array['plan','decide','fund','book','deliver'] when 'event' then array['plan','decide','fund','book','deliver'] when 'hackathon' then array['scope','decide','fund','build','deliver'] when 'project' then array['scope','decide','fund','build','deliver'] else array['plan','decide','fund','deliver'] end;
  insert into public.pact_milestones(pact_id,milestone_key,label,milestone_kind,position,completion_source)
  select p_pact_id, k, initcap(replace(k,'_',' ')), case when k in ('fund','funding') then 'funding' when k in ('book','booking') then 'booking' when k in ('deliver','build') then 'delivery' when k = 'decide' then 'decision' else 'planning' end, ordinality - 1, case when k in ('fund','funding') then 'verified_payment' when k in ('book','booking') then 'verified_booking' when k = 'decide' then 'decision' else 'member_event' end from unnest(keys) with ordinality as steps(k, ordinality) on conflict do nothing;
  perform public.refresh_pact_milestones(p_pact_id);
end; $$;

revoke all on function public.refresh_pact_milestones(uuid), public.refresh_pact_milestones_trigger() from public, anon, authenticated;

commit;
