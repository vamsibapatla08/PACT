begin;

create table public.pact_milestones (
  milestone_id uuid primary key default gen_random_uuid(),
  pact_id uuid not null references public.pacts(pact_id) on delete cascade,
  milestone_key text not null,
  label text not null,
  milestone_kind text not null check (milestone_kind in ('planning','decision','funding','booking','delivery')),
  position integer not null check (position >= 0),
  status text not null default 'pending' check (status in ('pending','in_progress','complete')),
  completion_source text not null check (completion_source in ('member_event','decision','verified_payment','verified_booking')),
  completed_at timestamptz,
  unique (pact_id, milestone_key)
);

create table public.pact_workflow_events (
  event_id uuid primary key default gen_random_uuid(),
  pact_id uuid not null references public.pacts(pact_id) on delete cascade,
  milestone_key text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  verified boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.pact_recommendations (
  recommendation_id uuid primary key default gen_random_uuid(),
  pact_id uuid not null references public.pacts(pact_id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id),
  source text not null default 'pactpilot' check (source = 'pactpilot'),
  summary text not null,
  options jsonb not null default '[]'::jsonb,
  tasks jsonb not null default '[]'::jsonb,
  costs jsonb not null default '[]'::jsonb,
  next_steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.pact_decisions (
  decision_id uuid primary key default gen_random_uuid(),
  pact_id uuid not null references public.pacts(pact_id) on delete cascade,
  recommendation_id uuid references public.pact_recommendations(recommendation_id) on delete set null,
  question text not null,
  options jsonb not null default '[]'::jsonb,
  approval_rule text not null default 'majority' check (approval_rule in ('unanimous','majority','host')),
  status text not null default 'open' check (status in ('open','approved','rejected')),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.pact_decision_votes (
  decision_id uuid not null references public.pact_decisions(decision_id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  vote text not null check (vote in ('approve','reject')),
  created_at timestamptz not null default now(),
  primary key (decision_id, user_id)
);

create index pact_milestones_pact_position_idx on public.pact_milestones(pact_id, position);
create index pact_recommendations_pact_created_idx on public.pact_recommendations(pact_id, created_at desc);
create index pact_decisions_pact_created_idx on public.pact_decisions(pact_id, created_at desc);

alter table public.pact_milestones enable row level security;
alter table public.pact_workflow_events enable row level security;
alter table public.pact_recommendations enable row level security;
alter table public.pact_decisions enable row level security;
alter table public.pact_decision_votes enable row level security;

create policy "Active members read milestones" on public.pact_milestones for select to authenticated using (exists (select 1 from public.pact_members m where m.pact_id = pact_milestones.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));
create policy "Active members read workflow events" on public.pact_workflow_events for select to authenticated using (exists (select 1 from public.pact_members m where m.pact_id = pact_workflow_events.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));
create policy "Active members read recommendations" on public.pact_recommendations for select to authenticated using (exists (select 1 from public.pact_members m where m.pact_id = pact_recommendations.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));
create policy "Active members read decisions" on public.pact_decisions for select to authenticated using (exists (select 1 from public.pact_members m where m.pact_id = pact_decisions.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));
create policy "Active members read votes" on public.pact_decision_votes for select to authenticated using (exists (select 1 from public.pact_decisions d join public.pact_members m on m.pact_id = d.pact_id where d.decision_id = pact_decision_votes.decision_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));

revoke all on public.pact_milestones, public.pact_workflow_events, public.pact_recommendations, public.pact_decisions, public.pact_decision_votes from public, anon, authenticated;
grant select on public.pact_milestones, public.pact_workflow_events, public.pact_recommendations, public.pact_decisions, public.pact_decision_votes to authenticated;

create or replace function public.seed_pact_milestones(p_pact_id uuid, p_pact_type text default 'general') returns void language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); keys text[];
begin
  if not exists (select 1 from public.pact_members where pact_id = p_pact_id and user_id = caller and membership_status = 'active') then raise exception 'Active Pact membership required' using errcode = '42501'; end if;
  keys := case lower(coalesce(p_pact_type, 'general')) when 'travel' then array['plan','decide','fund','book','deliver'] when 'event' then array['plan','decide','fund','book','deliver'] when 'hackathon' then array['scope','decide','fund','build','deliver'] when 'project' then array['scope','decide','fund','build','deliver'] else array['plan','decide','fund','deliver'] end;
  insert into public.pact_milestones(pact_id,milestone_key,label,milestone_kind,position,completion_source)
  select p_pact_id, k, initcap(replace(k,'_',' ')), case when k in ('fund','funding') then 'funding' when k in ('book','booking') then 'booking' when k in ('deliver','build') then 'delivery' when k = 'decide' then 'decision' else 'planning' end, ordinality - 1, case when k in ('fund','funding') then 'verified_payment' when k in ('book','booking') then 'verified_booking' when k = 'decide' then 'decision' else 'member_event' end from unnest(keys) with ordinality on conflict do nothing;
end; $$;

create or replace function public.save_pact_recommendation(p_pact_id uuid, p_summary text, p_options jsonb, p_tasks jsonb default '[]', p_costs jsonb default '[]', p_next_steps jsonb default '[]') returns uuid language plpgsql security definer set search_path = '' as $$ declare caller uuid := auth.uid(); result uuid; begin if not exists (select 1 from public.pact_members where pact_id=p_pact_id and user_id=caller and membership_status='active') then raise exception 'Active Pact membership required' using errcode='42501'; end if; if p_summary is null or trim(p_summary) = '' or p_options is null or jsonb_typeof(p_options) <> 'array' or p_tasks is null or jsonb_typeof(p_tasks) <> 'array' or p_costs is null or jsonb_typeof(p_costs) <> 'array' or p_next_steps is null or jsonb_typeof(p_next_steps) <> 'array' then raise exception 'Invalid recommendation'; end if; insert into public.pact_recommendations(pact_id,created_by,summary,options,tasks,costs,next_steps) values(p_pact_id,caller,trim(p_summary),p_options,p_tasks,p_costs,p_next_steps) returning recommendation_id into result; return result; end; $$;

create or replace function public.create_pact_decision(p_pact_id uuid, p_question text, p_options jsonb default '[]', p_recommendation_id uuid default null, p_approval_rule text default 'majority') returns uuid language plpgsql security definer set search_path = '' as $$ declare caller uuid := auth.uid(); result uuid; begin if not exists (select 1 from public.pact_members where pact_id=p_pact_id and user_id=caller and membership_status='active') then raise exception 'Active Pact membership required' using errcode='42501'; end if; if p_question is null or trim(p_question) = '' or p_options is null or jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) < 2 or p_approval_rule is null or p_approval_rule not in ('unanimous','majority','host') then raise exception 'Invalid decision'; end if; if p_recommendation_id is not null and not exists (select 1 from public.pact_recommendations where recommendation_id=p_recommendation_id and pact_id=p_pact_id) then raise exception 'Recommendation does not belong to this Pact'; end if; insert into public.pact_decisions(pact_id,recommendation_id,question,options,approval_rule,created_by) values(p_pact_id,p_recommendation_id,trim(p_question),p_options,p_approval_rule,caller) returning decision_id into result; return result; end; $$;

create or replace function public.cast_pact_decision_vote(p_decision_id uuid, p_vote text) returns public.pact_decisions language plpgsql security definer set search_path = '' as $$ declare caller uuid := auth.uid(); d public.pact_decisions; total integer; approvals integer; rejects integer; remaining integer; is_host boolean; begin if p_vote is null or p_vote not in ('approve','reject') then raise exception 'Invalid vote'; end if; select d0.* into d from public.pact_decisions d0 join public.pact_members m on m.pact_id=d0.pact_id and m.user_id=caller and m.membership_status='active' where d0.decision_id=p_decision_id for update of d0; if not found then raise exception 'Active Pact membership required' using errcode='42501'; end if; if d.status <> 'open' then raise exception 'Decision is closed'; end if; select exists (select 1 from public.pact_members where pact_id=d.pact_id and user_id=caller and role='host' and membership_status='active') into is_host; if d.approval_rule='host' and not is_host then raise exception 'Only the active host may vote on this decision' using errcode='42501'; end if; insert into public.pact_decision_votes(decision_id,user_id,vote) values(p_decision_id,caller,p_vote); select count(*) filter (where vote='approve'), count(*) filter (where vote='reject') into approvals, rejects from public.pact_decision_votes where decision_id=p_decision_id; select count(*) into total from public.pact_members where pact_id=d.pact_id and membership_status='active'; remaining := total - approvals - rejects; if d.approval_rule='host' and p_vote='approve' then update public.pact_decisions set status='approved' where decision_id=p_decision_id returning * into d; elsif d.approval_rule='host' and p_vote='reject' then update public.pact_decisions set status='rejected' where decision_id=p_decision_id returning * into d; elsif d.approval_rule='unanimous' and rejects > 0 then update public.pact_decisions set status='rejected' where decision_id=p_decision_id returning * into d; elsif d.approval_rule='unanimous' and approvals=total then update public.pact_decisions set status='approved' where decision_id=p_decision_id returning * into d; elsif d.approval_rule='majority' and approvals > total / 2 then update public.pact_decisions set status='approved' where decision_id=p_decision_id returning * into d; elsif d.approval_rule='majority' and approvals + remaining <= total / 2 then update public.pact_decisions set status='rejected' where decision_id=p_decision_id returning * into d; end if; return d; end; $$;

create or replace function public.get_pact_decision_counts(p_pact_id uuid) returns table(decision_id uuid, approve_count bigint, reject_count bigint, eligible_count bigint) language plpgsql security definer set search_path = '' as $$ begin if not exists (select 1 from public.pact_members where pact_id=p_pact_id and user_id=auth.uid() and membership_status='active') then raise exception 'Active Pact membership required' using errcode='42501'; end if; return query select d.decision_id, count(*) filter (where v.vote='approve'), count(*) filter (where v.vote='reject'), (select count(*) from public.pact_members m where m.pact_id=p_pact_id and m.membership_status='active') from public.pact_decisions d left join public.pact_decision_votes v on v.decision_id=d.decision_id where d.pact_id=p_pact_id group by d.decision_id; end; $$;

revoke all on function public.seed_pact_milestones(uuid,text), public.save_pact_recommendation(uuid,text,jsonb,jsonb,jsonb,jsonb), public.create_pact_decision(uuid,text,jsonb,uuid,text), public.cast_pact_decision_vote(uuid,text), public.get_pact_decision_counts(uuid) from public, anon;
grant execute on function public.seed_pact_milestones(uuid,text), public.save_pact_recommendation(uuid,text,jsonb,jsonb,jsonb,jsonb), public.create_pact_decision(uuid,text,jsonb,uuid,text), public.cast_pact_decision_vote(uuid,text), public.get_pact_decision_counts(uuid) to authenticated;

commit;
