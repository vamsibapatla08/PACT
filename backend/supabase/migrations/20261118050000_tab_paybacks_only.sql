-- The tab counted every confirmed send between members as a payback, so a plain Send money (or old test sends)
-- showed up as "You're owed $8" with nothing on the tab. Now a send only counts when it was made as a payback:
-- the app marks it here, with the send's request id, before the PIN.
begin;

create table public.pact_tab_paybacks (
  sender_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  request_id uuid not null,
  pact_id uuid not null references public.pacts(pact_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (sender_id, request_id)
);

alter table public.pact_tab_paybacks enable row level security;
revoke all on table public.pact_tab_paybacks from public, anon, authenticated;
grant select on table public.pact_tab_paybacks to authenticated;
create policy "Members see their pact's payback marks"
on public.pact_tab_paybacks for select to authenticated
using (exists (select 1 from public.pact_members m where m.pact_id = pact_tab_paybacks.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));

-- Called by Pay back just before the send. Marks my own send only, in a pact I'm in. Safe to call twice.
create or replace function public.mark_pact_payback(p_pact_id uuid, p_request_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare caller uuid := public.pact_tab_require_member(p_pact_id);
begin
  insert into public.pact_tab_paybacks (sender_id, request_id, pact_id) values (caller, p_request_id, p_pact_id)
  on conflict (sender_id, request_id) do nothing;
end; $$;

revoke all on function public.mark_pact_payback(uuid, uuid) from public, anon;
grant execute on function public.mark_pact_payback(uuid, uuid) to authenticated;

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
    -- Only sends made as a payback (marked by Pay back before the PIN) count. A plain Send money is a gift or a
    -- side deal, and must never make it look like someone owes money.
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

revoke all on function public.get_pact_tab(uuid) from public, anon;
grant execute on function public.get_pact_tab(uuid) to authenticated;

commit;
