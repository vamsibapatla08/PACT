-- A payment split from someone's Wallet activity waits for the group: it shows as "waiting for approval" and only
-- counts on the tab once everyone it's split with has approved their part. Whoever paid counts as approving.
begin;

alter table public.pact_expenses drop constraint if exists pact_expenses_status_check;
alter table public.pact_expenses add constraint pact_expenses_status_check check (status in ('active', 'voided', 'proposed'));
alter table public.pact_tab_events drop constraint if exists pact_tab_events_event_type_check;
alter table public.pact_tab_events add constraint pact_tab_events_event_type_check
  check (event_type in ('added', 'joined', 'resplit', 'voided', 'settled_cash', 'proposed', 'approved'));

create table if not exists public.pact_expense_approvals (
  expense_id uuid not null references public.pact_expenses(expense_id) on delete cascade,
  pact_id uuid not null references public.pacts(pact_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (expense_id, user_id)
);
alter table public.pact_expense_approvals enable row level security;
revoke all on table public.pact_expense_approvals from public, anon, authenticated;
grant select on table public.pact_expense_approvals to authenticated;
create policy "Members see approvals in their pacts" on public.pact_expense_approvals for select to authenticated
using (exists (select 1 from public.pact_members m where m.pact_id = pact_expense_approvals.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));

-- Everyone it's split with has approved: it goes on the tab.
create or replace function public.pact_expense_settle_approval(p_expense_id uuid, p_actor uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare e public.pact_expenses;
begin
  select * into e from public.pact_expenses where expense_id = p_expense_id for update;
  if e.status <> 'proposed' then return; end if;
  if not exists (
    select 1 from public.pact_expense_shares s
    where s.expense_id = p_expense_id
      and not exists (select 1 from public.pact_expense_approvals a where a.expense_id = p_expense_id and a.user_id = s.user_id)
  ) then
    update public.pact_expenses set status = 'active', updated_at = now() where expense_id = p_expense_id;
    insert into public.pact_tab_events (pact_id, expense_id, actor_id, event_type, details)
    values (e.pact_id, p_expense_id, p_actor, 'approved', jsonb_build_object('title', e.title, 'total_cents', e.total_cents));
  end if;
end; $$;
revoke all on function public.pact_expense_settle_approval(uuid, uuid) from public, anon, authenticated;

create or replace function public.add_pact_expense(p_pact_id uuid, p_title text, p_total_cents bigint, p_paid_by uuid DEFAULT NULL::uuid, p_split_with uuid[] DEFAULT NULL::uuid[], p_custom_shares jsonb DEFAULT NULL::jsonb, p_source text DEFAULT 'manual'::text, p_source_ref text DEFAULT NULL::text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare caller uuid := public.pact_tab_require_member(p_pact_id); payer uuid := coalesce(p_paid_by, caller); new_id uuid; users uuid[];
begin
  if p_source not in ('manual', 'wallet', 'grok') then raise exception 'Use import_pact_plan_to_tab for funded plans'; end if;
  if p_total_cents is null or p_total_cents <= 0 or p_total_cents > 100000000 then raise exception 'Amount must be between 1 cent and $1,000,000'; end if;
  if not exists (select 1 from public.pact_members where pact_id = p_pact_id and user_id = payer and membership_status = 'active') then raise exception 'Whoever paid must be in the pact'; end if;
  -- A wallet payment is proof the caller paid, so only they can tag it.
  if p_source = 'wallet' and (payer <> caller or p_source_ref is null or p_source_ref !~ '^0x[0-9a-fA-F]{64}$') then raise exception 'Only the sender can tag a wallet payment'; end if;
  if p_source_ref is not null then
    select expense_id into new_id from public.pact_expenses where pact_id = p_pact_id and source = p_source and source_ref = p_source_ref and status in ('active', 'proposed');
    if new_id is not null then return new_id; end if;
  end if;
  users := coalesce(p_split_with, array(select user_id from public.pact_members where pact_id = p_pact_id and membership_status = 'active'));
  -- From the wallet, it waits for the group to approve before it counts.
  insert into public.pact_expenses (pact_id, title, total_cents, source, source_ref, created_by, status)
  values (p_pact_id, trim(p_title), p_total_cents, p_source, p_source_ref, caller, case when p_source = 'wallet' then 'proposed' else 'active' end)
  returning expense_id into new_id;
  insert into public.pact_expense_payers (expense_id, pact_id, user_id, amount_cents) values (new_id, p_pact_id, payer, p_total_cents);
  perform public.pact_tab_write_shares(new_id, p_pact_id, p_total_cents, users, p_custom_shares);
  insert into public.pact_tab_events (pact_id, expense_id, actor_id, event_type, details)
  values (p_pact_id, new_id, caller, case when p_source = 'wallet' then 'proposed' else 'added' end,
    jsonb_build_object('title', trim(p_title), 'total_cents', p_total_cents, 'paid_by', payer, 'after', public.pact_tab_split_json(new_id)));
  if p_source = 'wallet' then
    insert into public.pact_expense_approvals (expense_id, pact_id, user_id) values (new_id, p_pact_id, payer) on conflict do nothing;
    perform public.pact_expense_settle_approval(new_id, caller);
  end if;
  return new_id;
end; $$;

-- I approve my part of a split that's waiting.
create or replace function public.approve_pact_expense(p_expense_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare caller uuid := auth.uid(); e public.pact_expenses;
begin
  select * into e from public.pact_expenses where expense_id = p_expense_id;
  if e.expense_id is null then raise exception 'That split is gone'; end if;
  perform public.pact_tab_require_member(e.pact_id);
  if e.status <> 'proposed' then raise exception 'That split is already settled'; end if;
  if not exists (select 1 from public.pact_expense_shares where expense_id = p_expense_id and user_id = caller) then
    raise exception 'This split doesn''t include you';
  end if;
  insert into public.pact_expense_approvals (expense_id, pact_id, user_id) values (p_expense_id, e.pact_id, caller) on conflict do nothing;
  perform public.pact_expense_settle_approval(p_expense_id, caller);
end; $$;
revoke all on function public.approve_pact_expense(uuid) from public, anon;
grant execute on function public.approve_pact_expense(uuid) to authenticated;

-- The tab, plus the splits waiting for approval (they don't count toward balances until approved).
create or replace function public.get_pact_tab(p_pact_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  caller uuid := public.pact_tab_require_member(p_pact_id);
  members jsonb; expenses jsonb; history jsonb; pending jsonb;
  debtors uuid[]; debts bigint[]; creditors uuid[]; credits bigint[];
  i integer := 1; j integer := 1; amount bigint; plan jsonb := '[]'::jsonb;
begin
  with people as (
    select m.user_id, coalesce(p.name, 'Someone') as name from public.pact_members m left join public.profiles p on p.id = m.user_id
    where m.pact_id = p_pact_id and (m.membership_status = 'active'
      or exists (select 1 from public.pact_expense_shares s join public.pact_expenses e on e.expense_id = s.expense_id and e.status = 'active' where s.pact_id = p_pact_id and s.user_id = m.user_id)
      or exists (select 1 from public.pact_expense_payers s join public.pact_expenses e on e.expense_id = s.expense_id and e.status = 'active' where s.pact_id = p_pact_id and s.user_id = m.user_id))
  ),
  paid as (select y.user_id, sum(y.amount_cents) c from public.pact_expense_payers y join public.pact_expenses e on e.expense_id = y.expense_id and e.status = 'active' where y.pact_id = p_pact_id group by 1),
  owed as (select s.user_id, sum(s.amount_cents) c from public.pact_expense_shares s join public.pact_expenses e on e.expense_id = s.expense_id and e.status = 'active' where s.pact_id = p_pact_id group by 1),
  moves as (
    select t.sender_id as from_user, t.recipient_id as to_user, round(t.amount_usdc * 100)::bigint as c
    from public.pact_transfers t join public.pact_tab_paybacks k on k.sender_id = t.sender_id and k.request_id = t.request_id
    where t.pact_id = p_pact_id and k.pact_id = p_pact_id and t.status = 'confirmed'
    union all select from_user, to_user, amount_cents from public.pact_settlements where pact_id = p_pact_id
  ),
  sent as (select from_user as user_id, sum(c) c from moves group by 1),
  got as (select to_user as user_id, sum(c) c from moves group by 1)
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', pe.user_id, 'name', pe.name, 'is_you', pe.user_id = caller,
    'paid_cents', coalesce(paid.c, 0), 'share_cents', coalesce(owed.c, 0),
    'paid_back_cents', coalesce(sent.c, 0), 'got_back_cents', coalesce(got.c, 0),
    'balance_cents', coalesce(paid.c, 0) - coalesce(owed.c, 0) + coalesce(sent.c, 0) - coalesce(got.c, 0)
  ) order by pe.name), '[]'::jsonb)
  into members
  from people pe left join paid using (user_id) left join owed using (user_id) left join sent using (user_id) left join got using (user_id);

  select array_agg((m->>'user_id')::uuid order by (m->>'balance_cents')::bigint), array_agg(-(m->>'balance_cents')::bigint order by (m->>'balance_cents')::bigint)
  into debtors, debts from jsonb_array_elements(members) m where (m->>'balance_cents')::bigint < 0;
  select array_agg((m->>'user_id')::uuid order by (m->>'balance_cents')::bigint desc), array_agg((m->>'balance_cents')::bigint order by (m->>'balance_cents')::bigint desc)
  into creditors, credits from jsonb_array_elements(members) m where (m->>'balance_cents')::bigint > 0;
  while debtors is not null and creditors is not null and i <= cardinality(debtors) and j <= cardinality(creditors) loop
    amount := least(debts[i], credits[j]);
    plan := plan || jsonb_build_object('from', debtors[i], 'to', creditors[j], 'amount_cents', amount);
    debts[i] := debts[i] - amount; credits[j] := credits[j] - amount;
    if debts[i] = 0 then i := i + 1; end if;
    if credits[j] = 0 then j := j + 1; end if;
  end loop;

  select coalesce(jsonb_agg(x order by x->>'spent_at' desc), '[]'::jsonb) into expenses from (
    select jsonb_build_object('expense_id', e.expense_id, 'title', e.title, 'total_cents', e.total_cents, 'spent_at', e.spent_at,
      'source', e.source, 'source_ref', e.source_ref, 'created_by', e.created_by, 'version', e.version,
      'payers', (select coalesce(jsonb_object_agg(user_id::text, amount_cents), '{}'::jsonb) from public.pact_expense_payers where expense_id = e.expense_id),
      'shares', public.pact_tab_split_json(e.expense_id)) as x
    from public.pact_expenses e where e.pact_id = p_pact_id and e.status = 'active' order by e.spent_at desc limit 200
  ) rows;

  select coalesce(jsonb_agg(x order by x->>'spent_at' desc), '[]'::jsonb) into pending from (
    select jsonb_build_object('expense_id', e.expense_id, 'title', e.title, 'total_cents', e.total_cents, 'spent_at', e.spent_at,
      'source', e.source, 'source_ref', e.source_ref, 'created_by', e.created_by,
      'payers', (select coalesce(jsonb_object_agg(user_id::text, amount_cents), '{}'::jsonb) from public.pact_expense_payers where expense_id = e.expense_id),
      'shares', public.pact_tab_split_json(e.expense_id),
      'approved_by', (select coalesce(jsonb_agg(a.user_id), '[]'::jsonb) from public.pact_expense_approvals a where a.expense_id = e.expense_id)) as x
    from public.pact_expenses e where e.pact_id = p_pact_id and e.status = 'proposed' order by e.spent_at desc limit 50
  ) rows;

  select coalesce(jsonb_agg(jsonb_build_object('event_type', event_type, 'expense_id', expense_id, 'actor_id', actor_id, 'details', details, 'created_at', created_at) order by created_at desc), '[]'::jsonb)
  into history from (select * from public.pact_tab_events where pact_id = p_pact_id order by created_at desc limit 30) recent;

  return jsonb_build_object('currency', 'USDC', 'members', members, 'expenses', expenses, 'pending', pending, 'settle_up', plan, 'history', history);
end; $$;

-- Live updates for approvals, so a waiting split turns into a tab entry on everyone's screen.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pact_expense_approvals') then
    alter publication supabase_realtime add table public.pact_expense_approvals;
  end if;
end $$;
commit;
