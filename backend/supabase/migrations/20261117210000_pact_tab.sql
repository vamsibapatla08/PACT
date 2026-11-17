-- PactTab: the live group tab. Anyone logs what they paid, says who it's for, and the tab works out who owes whom.
-- It sits next to PactSplit (the escrow for big up-front buys) and never rewrites a paid share: a re-split only
-- changes who owes what on the tab, and people square up with a USDC send or a cash payback.
-- All money is whole cents (1 USDC = 100 cents) so splits always add up exactly.
begin;

create table public.pact_expenses (
  expense_id uuid primary key default gen_random_uuid(),
  pact_id uuid not null references public.pacts(pact_id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 120),
  total_cents bigint not null check (total_cents > 0),
  spent_at timestamptz not null default now(),
  -- manual: typed in. wallet: tagged from a wallet payment (source_ref = tx hash). plan: a funded PactSplit (source_ref = payment_id). grok: Grok logged it.
  source text not null default 'manual' check (source in ('manual', 'wallet', 'plan', 'grok')),
  source_ref text,
  created_by uuid not null references auth.users(id),
  status text not null default 'active' check (status in ('active', 'voided')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (expense_id, pact_id)
);
-- The same wallet payment or funded plan can only go on a tab once.
create unique index pact_expenses_source_once on public.pact_expenses (pact_id, source, source_ref) where source_ref is not null and status = 'active';
create index pact_expenses_pact_idx on public.pact_expenses (pact_id, spent_at desc);

-- Who paid. Usually one person; a funded plan has one row per member who paid their share.
create table public.pact_expense_payers (
  expense_id uuid not null,
  pact_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  primary key (expense_id, user_id),
  foreign key (expense_id, pact_id) references public.pact_expenses(expense_id, pact_id) on delete cascade
);

-- Who it's for, and each person's part of it.
create table public.pact_expense_shares (
  expense_id uuid not null,
  pact_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount_cents bigint not null check (amount_cents >= 0),
  primary key (expense_id, user_id),
  foreign key (expense_id, pact_id) references public.pact_expenses(expense_id, pact_id) on delete cascade
);

-- Paybacks outside the wallet (cash, Venmo). Only the person who got the money can record one,
-- so nobody can mark themselves paid up. USDC paybacks come straight from confirmed pact_transfers.
create table public.pact_settlements (
  settlement_id uuid primary key default gen_random_uuid(),
  pact_id uuid not null references public.pacts(pact_id) on delete cascade,
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  note text check (note is null or length(note) <= 200),
  created_at timestamptz not null default now(),
  check (from_user <> to_user)
);
create index pact_settlements_pact_idx on public.pact_settlements (pact_id);

-- Every change to the tab, with the split before and after, so Grok and the group can see what moved and why.
create table public.pact_tab_events (
  event_id uuid primary key default gen_random_uuid(),
  pact_id uuid not null references public.pacts(pact_id) on delete cascade,
  expense_id uuid references public.pact_expenses(expense_id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  event_type text not null check (event_type in ('added', 'joined', 'resplit', 'voided', 'settled_cash')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);
create index pact_tab_events_pact_idx on public.pact_tab_events (pact_id, created_at desc);

alter table public.pact_expenses enable row level security;
alter table public.pact_expense_payers enable row level security;
alter table public.pact_expense_shares enable row level security;
alter table public.pact_settlements enable row level security;
alter table public.pact_tab_events enable row level security;
revoke all on public.pact_expenses, public.pact_expense_payers, public.pact_expense_shares, public.pact_settlements, public.pact_tab_events from public, anon, authenticated;
grant select on public.pact_expenses, public.pact_expense_payers, public.pact_expense_shares, public.pact_settlements, public.pact_tab_events to authenticated;

create policy "Active members read the tab" on public.pact_expenses for select to authenticated using (exists (select 1 from public.pact_members m where m.pact_id = pact_expenses.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));
create policy "Active members read tab payers" on public.pact_expense_payers for select to authenticated using (exists (select 1 from public.pact_members m where m.pact_id = pact_expense_payers.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));
create policy "Active members read tab shares" on public.pact_expense_shares for select to authenticated using (exists (select 1 from public.pact_members m where m.pact_id = pact_expense_shares.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));
create policy "Active members read settlements" on public.pact_settlements for select to authenticated using (exists (select 1 from public.pact_members m where m.pact_id = pact_settlements.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));
create policy "Active members read tab history" on public.pact_tab_events for select to authenticated using (exists (select 1 from public.pact_members m where m.pact_id = pact_tab_events.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));

-- ---- Helpers (not callable by clients)

create or replace function public.pact_tab_require_member(p_pact_id uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare caller uuid := auth.uid();
begin
  if caller is null or not exists (select 1 from public.pact_members where pact_id = p_pact_id and user_id = caller and membership_status = 'active') then
    raise exception 'Active Pact membership required' using errcode = '42501';
  end if;
  return caller;
end; $$;

-- Splits p_total evenly; the leftover cents go one each to the first people by id, so it always adds up.
create or replace function public.pact_tab_equal_split(p_total bigint, p_users uuid[])
returns table (user_id uuid, amount_cents bigint) language sql immutable set search_path = '' as $$
  with people as (select distinct u from unnest(p_users) as u where u is not null),
  ranked as (select u, row_number() over (order by u) as n, count(*) over () as total from people)
  select u, p_total / total + case when n <= p_total % total then 1 else 0 end from ranked;
$$;

create or replace function public.pact_tab_split_json(p_expense_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(user_id::text, amount_cents order by user_id), '{}'::jsonb) from public.pact_expense_shares where expense_id = p_expense_id;
$$;

-- Replaces an expense's shares: an even split across p_users, or exact cents from p_custom ({"<user_id>": cents}).
create or replace function public.pact_tab_write_shares(p_expense_id uuid, p_pact_id uuid, p_total bigint, p_users uuid[], p_custom jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare item record; custom_total bigint := 0; bad integer;
begin
  delete from public.pact_expense_shares where expense_id = p_expense_id;
  if p_custom is not null and jsonb_typeof(p_custom) = 'object' and p_custom <> '{}'::jsonb then
    for item in select key, value from jsonb_each(p_custom) loop
      if item.key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(item.value) <> 'number' or (item.value::text)::numeric < 0 or (item.value::text)::numeric <> trunc((item.value::text)::numeric) then
        raise exception 'Custom shares must be whole cents per member';
      end if;
      custom_total := custom_total + (item.value::text)::bigint;
    end loop;
    if custom_total <> p_total then raise exception 'Custom shares add up to % cents, not %', custom_total, p_total; end if;
    insert into public.pact_expense_shares (expense_id, pact_id, user_id, amount_cents)
    select p_expense_id, p_pact_id, key::uuid, (value::text)::bigint from jsonb_each(p_custom);
  else
    if p_users is null or cardinality(p_users) = 0 then raise exception 'Say who the expense is for'; end if;
    insert into public.pact_expense_shares (expense_id, pact_id, user_id, amount_cents)
    select p_expense_id, p_pact_id, s.user_id, s.amount_cents from public.pact_tab_equal_split(p_total, p_users) s;
  end if;
  select count(*) into bad from public.pact_expense_shares s
  where s.expense_id = p_expense_id and not exists (select 1 from public.pact_members m where m.pact_id = p_pact_id and m.user_id = s.user_id and m.membership_status = 'active');
  if bad > 0 then raise exception 'Everyone in a split must be in the pact'; end if;
end; $$;

-- ---- Client functions

-- Log something someone paid. With no p_split_with and no p_custom_shares it's split evenly across everyone in the pact.
create or replace function public.add_pact_expense(
  p_pact_id uuid, p_title text, p_total_cents bigint,
  p_paid_by uuid default null, p_split_with uuid[] default null, p_custom_shares jsonb default null,
  p_source text default 'manual', p_source_ref text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare caller uuid := public.pact_tab_require_member(p_pact_id); payer uuid := coalesce(p_paid_by, caller); new_id uuid; users uuid[];
begin
  if p_source not in ('manual', 'wallet', 'grok') then raise exception 'Use import_pact_plan_to_tab for funded plans'; end if;
  if p_total_cents is null or p_total_cents <= 0 or p_total_cents > 100000000 then raise exception 'Amount must be between 1 cent and $1,000,000'; end if;
  if not exists (select 1 from public.pact_members where pact_id = p_pact_id and user_id = payer and membership_status = 'active') then raise exception 'Whoever paid must be in the pact'; end if;
  -- A wallet payment is proof the caller paid, so only they can tag it.
  if p_source = 'wallet' and (payer <> caller or p_source_ref is null or p_source_ref !~ '^0x[0-9a-fA-F]{64}$') then raise exception 'Only the sender can tag a wallet payment'; end if;
  if p_source_ref is not null then
    select expense_id into new_id from public.pact_expenses where pact_id = p_pact_id and source = p_source and source_ref = p_source_ref and status = 'active';
    if new_id is not null then return new_id; end if;
  end if;
  users := coalesce(p_split_with, array(select user_id from public.pact_members where pact_id = p_pact_id and membership_status = 'active'));
  insert into public.pact_expenses (pact_id, title, total_cents, source, source_ref, created_by)
  values (p_pact_id, trim(p_title), p_total_cents, p_source, p_source_ref, caller) returning expense_id into new_id;
  insert into public.pact_expense_payers (expense_id, pact_id, user_id, amount_cents) values (new_id, p_pact_id, payer, p_total_cents);
  perform public.pact_tab_write_shares(new_id, p_pact_id, p_total_cents, users, p_custom_shares);
  insert into public.pact_tab_events (pact_id, expense_id, actor_id, event_type, details)
  values (p_pact_id, new_id, caller, 'added', jsonb_build_object('title', trim(p_title), 'total_cents', p_total_cents, 'paid_by', payer, 'after', public.pact_tab_split_json(new_id)));
  return new_id;
end; $$;

-- "Can I crash with you?": the caller joins an expense and it's re-split evenly across everyone on it.
-- Everyone else's part only goes down, so it needs nobody else's say-so. Returns the split before and after.
create or replace function public.join_pact_expense(p_expense_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.pact_expenses; caller uuid; before_split jsonb; users uuid[];
begin
  select * into e from public.pact_expenses where expense_id = p_expense_id for update;
  if not found or e.status <> 'active' then raise exception 'That expense is unavailable'; end if;
  caller := public.pact_tab_require_member(e.pact_id);
  before_split := public.pact_tab_split_json(p_expense_id);
  if before_split ? caller::text then return jsonb_build_object('status', 'already_in', 'expense_id', p_expense_id, 'split', before_split); end if;
  users := array(select user_id from public.pact_expense_shares where expense_id = p_expense_id and amount_cents > 0) || caller;
  perform public.pact_tab_write_shares(p_expense_id, e.pact_id, e.total_cents, users, null);
  update public.pact_expenses set version = version + 1, updated_at = now() where expense_id = p_expense_id;
  insert into public.pact_tab_events (pact_id, expense_id, actor_id, event_type, details)
  values (e.pact_id, p_expense_id, caller, 'joined', jsonb_build_object('before', before_split, 'after', public.pact_tab_split_json(p_expense_id)));
  return jsonb_build_object('status', 'joined', 'expense_id', p_expense_id, 'before', before_split, 'after', public.pact_tab_split_json(p_expense_id));
end; $$;

-- Change who an expense is for. The payer, whoever logged it, or the host can do this; every change is in the history.
create or replace function public.resplit_pact_expense(p_expense_id uuid, p_split_with uuid[] default null, p_custom_shares jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.pact_expenses; caller uuid; before_split jsonb;
begin
  select * into e from public.pact_expenses where expense_id = p_expense_id for update;
  if not found or e.status <> 'active' then raise exception 'That expense is unavailable'; end if;
  caller := public.pact_tab_require_member(e.pact_id);
  if caller <> e.created_by and not exists (select 1 from public.pact_expense_payers where expense_id = p_expense_id and user_id = caller)
     and not exists (select 1 from public.pact_members where pact_id = e.pact_id and user_id = caller and role = 'host') then
    raise exception 'Only the payer, whoever logged it, or the host can re-split this' using errcode = '42501';
  end if;
  before_split := public.pact_tab_split_json(p_expense_id);
  perform public.pact_tab_write_shares(p_expense_id, e.pact_id, e.total_cents, p_split_with, p_custom_shares);
  update public.pact_expenses set version = version + 1, updated_at = now() where expense_id = p_expense_id;
  insert into public.pact_tab_events (pact_id, expense_id, actor_id, event_type, details)
  values (e.pact_id, p_expense_id, caller, 'resplit', jsonb_build_object('before', before_split, 'after', public.pact_tab_split_json(p_expense_id)));
  return jsonb_build_object('status', 'resplit', 'expense_id', p_expense_id, 'before', before_split, 'after', public.pact_tab_split_json(p_expense_id));
end; $$;

create or replace function public.void_pact_expense(p_expense_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.pact_expenses; caller uuid;
begin
  select * into e from public.pact_expenses where expense_id = p_expense_id for update;
  if not found or e.status <> 'active' then raise exception 'That expense is unavailable'; end if;
  caller := public.pact_tab_require_member(e.pact_id);
  if caller <> e.created_by and not exists (select 1 from public.pact_expense_payers where expense_id = p_expense_id and user_id = caller)
     and not exists (select 1 from public.pact_members where pact_id = e.pact_id and user_id = caller and role = 'host') then
    raise exception 'Only the payer, whoever logged it, or the host can remove this' using errcode = '42501';
  end if;
  update public.pact_expenses set status = 'voided', updated_at = now() where expense_id = p_expense_id;
  insert into public.pact_tab_events (pact_id, expense_id, actor_id, event_type, details) values (e.pact_id, p_expense_id, caller, 'voided', jsonb_build_object('title', e.title, 'total_cents', e.total_cents));
end; $$;

-- Puts a PactSplit plan on the tab: each member who paid their share is a payer, and it starts split between them,
-- so it changes nobody's balance until someone joins it later.
create or replace function public.import_pact_plan_to_tab(p_pact_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare caller uuid := public.pact_tab_require_member(p_pact_id); plan public.pact_payments; new_id uuid; total bigint; label text;
begin
  select * into plan from public.pact_payments where pact_id = p_pact_id;
  if not found then raise exception 'This pact has no funding plan yet'; end if;
  select expense_id into new_id from public.pact_expenses where pact_id = p_pact_id and source = 'plan' and source_ref = plan.payment_id::text and status = 'active';
  if new_id is not null then return new_id; end if;
  select coalesce(sum(round(amount_usdc * 100)), 0)::bigint into total from public.pact_shares where payment_id = plan.payment_id and status = 'paid';
  if total <= 0 then raise exception 'Nobody has paid into the plan yet'; end if;
  select coalesce(nullif(trim(p.description), ''), p.name) into label from public.pacts p where p.pact_id = p_pact_id;
  insert into public.pact_expenses (pact_id, title, total_cents, source, source_ref, created_by)
  values (p_pact_id, left(label, 120), total, 'plan', plan.payment_id::text, caller) returning expense_id into new_id;
  insert into public.pact_expense_payers (expense_id, pact_id, user_id, amount_cents)
  select new_id, p_pact_id, user_id, round(amount_usdc * 100)::bigint from public.pact_shares where payment_id = plan.payment_id and status = 'paid';
  insert into public.pact_expense_shares (expense_id, pact_id, user_id, amount_cents)
  select new_id, p_pact_id, user_id, amount_cents from public.pact_expense_payers where expense_id = new_id;
  insert into public.pact_tab_events (pact_id, expense_id, actor_id, event_type, details)
  values (p_pact_id, new_id, caller, 'added', jsonb_build_object('title', label, 'total_cents', total, 'from_plan', plan.payment_id, 'after', public.pact_tab_split_json(new_id)));
  return new_id;
end; $$;

-- The person who was paid back in cash records it.
create or replace function public.record_pact_cash_payback(p_pact_id uuid, p_from_user uuid, p_amount_cents bigint, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare caller uuid := public.pact_tab_require_member(p_pact_id); new_id uuid;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'Amount must be positive'; end if;
  if p_from_user = caller or not exists (select 1 from public.pact_members where pact_id = p_pact_id and user_id = p_from_user) then raise exception 'Pick who paid you back'; end if;
  insert into public.pact_settlements (pact_id, from_user, to_user, amount_cents, note) values (p_pact_id, p_from_user, caller, p_amount_cents, nullif(trim(p_note), '')) returning settlement_id into new_id;
  insert into public.pact_tab_events (pact_id, actor_id, event_type, details) values (p_pact_id, caller, 'settled_cash', jsonb_build_object('from', p_from_user, 'to', caller, 'amount_cents', p_amount_cents));
  return new_id;
end; $$;

-- The whole tab in one read: each member's balance (positive = they're owed), every expense,
-- and the fewest paybacks that square everyone up.
create or replace function public.get_pact_tab(p_pact_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  caller uuid := public.pact_tab_require_member(p_pact_id);
  members jsonb; expenses jsonb; history jsonb;
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
    select sender_id as from_user, recipient_id as to_user, round(amount_usdc * 100)::bigint as c from public.pact_transfers where pact_id = p_pact_id and status = 'confirmed'
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

  -- Fewest paybacks: biggest debtor pays biggest creditor until everyone is square.
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

  select coalesce(jsonb_agg(jsonb_build_object('event_type', event_type, 'expense_id', expense_id, 'actor_id', actor_id, 'details', details, 'created_at', created_at) order by created_at desc), '[]'::jsonb)
  into history from (select * from public.pact_tab_events where pact_id = p_pact_id order by created_at desc limit 30) recent;

  return jsonb_build_object('currency', 'USDC', 'members', members, 'expenses', expenses, 'settle_up', plan, 'history', history);
end; $$;

revoke all on function public.pact_tab_require_member(uuid), public.pact_tab_equal_split(bigint, uuid[]), public.pact_tab_split_json(uuid), public.pact_tab_write_shares(uuid, uuid, bigint, uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.add_pact_expense(uuid, text, bigint, uuid, uuid[], jsonb, text, text), public.join_pact_expense(uuid), public.resplit_pact_expense(uuid, uuid[], jsonb), public.void_pact_expense(uuid), public.import_pact_plan_to_tab(uuid), public.record_pact_cash_payback(uuid, uuid, bigint, text), public.get_pact_tab(uuid) from public, anon;
grant execute on function public.add_pact_expense(uuid, text, bigint, uuid, uuid[], jsonb, text, text), public.join_pact_expense(uuid), public.resplit_pact_expense(uuid, uuid[], jsonb), public.void_pact_expense(uuid), public.import_pact_plan_to_tab(uuid), public.record_pact_cash_payback(uuid, uuid, bigint, text), public.get_pact_tab(uuid) to authenticated;

commit;
