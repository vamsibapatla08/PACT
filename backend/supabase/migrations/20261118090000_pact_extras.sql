-- Extras: things the group adds after the split is locked. The first split stays as it is (held in PactSplit).
-- Extras go into a round with their own price each; the group approves the round, then each person pays the
-- coordinator their share directly with their PIN. A send counts toward the round only when the app marked it
-- for the round before the PIN (like tab paybacks), so a plain Send money never does.
begin;

alter table public.pact_items add column if not exists extra boolean not null default false;
alter table public.pact_items add column if not exists round_id uuid;

create table public.pact_extras_rounds (
  round_id uuid primary key default gen_random_uuid(),
  pact_id uuid not null references public.pacts(pact_id) on delete cascade,
  share_cents bigint not null check (share_cents > 0),
  status text not null default 'open' check (status in ('open', 'approved', 'cancelled')),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index pact_extras_rounds_pact_idx on public.pact_extras_rounds (pact_id, created_at desc);
alter table public.pact_items add constraint pact_items_round_fk foreign key (round_id) references public.pact_extras_rounds(round_id) on delete set null;

create table public.pact_extras_votes (
  round_id uuid not null references public.pact_extras_rounds(round_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  vote text not null check (vote in ('approve', 'reject')),
  created_at timestamptz not null default now(),
  primary key (round_id, user_id)
);

create table public.pact_extras_payments (
  sender_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  request_id uuid not null,
  round_id uuid not null references public.pact_extras_rounds(round_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (sender_id, request_id)
);

alter table public.pact_extras_rounds enable row level security;
alter table public.pact_extras_votes enable row level security;
alter table public.pact_extras_payments enable row level security;
revoke all on table public.pact_extras_rounds, public.pact_extras_votes, public.pact_extras_payments from public, anon, authenticated;
grant select on table public.pact_extras_rounds, public.pact_extras_votes, public.pact_extras_payments to authenticated;
grant select, insert, update, delete on table public.pact_extras_rounds, public.pact_extras_votes, public.pact_extras_payments to service_role;

create policy "Members see their pact's extras rounds" on public.pact_extras_rounds for select to authenticated
using (exists (select 1 from public.pact_members m where m.pact_id = pact_extras_rounds.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));
create policy "Members see extras votes" on public.pact_extras_votes for select to authenticated
using (exists (select 1 from public.pact_extras_rounds r join public.pact_members m on m.pact_id = r.pact_id
  where r.round_id = pact_extras_votes.round_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));
create policy "Members see extras payment marks" on public.pact_extras_payments for select to authenticated
using (exists (select 1 from public.pact_extras_rounds r join public.pact_members m on m.pact_id = r.pact_id
  where r.round_id = pact_extras_payments.round_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));

-- Items: before the split, anything; after it, only extras (and only ones not yet sent for approval can be removed).
drop policy if exists "Members add items until the split is set up" on public.pact_items;
create policy "Members add items, and extras after the split" on public.pact_items for insert to authenticated
with check (
  created_by = (select auth.uid())
  and exists (select 1 from public.pact_members m where m.pact_id = pact_items.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active')
  and round_id is null
  and (extra = exists (select 1 from public.pact_payments p where p.pact_id = pact_items.pact_id))
);
drop policy if exists "The adder or the coordinator removes items until the split is set up" on public.pact_items;
create policy "The adder or the coordinator removes items before they are locked" on public.pact_items for delete to authenticated
using (
  (case when extra then round_id is null else not exists (select 1 from public.pact_payments p where p.pact_id = pact_items.pact_id) end)
  and (
    created_by = (select auth.uid())
    or exists (select 1 from public.pact_members m where m.pact_id = pact_items.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active' and m.role = 'host')
  )
);

-- Put the extras added so far up for approval, priced at their total each. Any member can.
create or replace function public.send_pact_extras_for_approval(p_pact_id uuid)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare caller uuid := public.pact_tab_require_member(p_pact_id); total numeric; new_id uuid;
begin
  if exists (select 1 from public.pact_extras_rounds where pact_id = p_pact_id and status = 'open') then
    raise exception 'Extras are already up for approval. Approve or cancel those first.';
  end if;
  select sum(price_each) into total from public.pact_items where pact_id = p_pact_id and extra and round_id is null and price_each is not null;
  if total is null or total <= 0 then raise exception 'Add at least one extra with a price first.'; end if;
  insert into public.pact_extras_rounds (pact_id, share_cents, created_by) values (p_pact_id, round(total * 100)::bigint, caller) returning round_id into new_id;
  update public.pact_items set round_id = new_id where pact_id = p_pact_id and extra and round_id is null;
  -- Sending them counts as my approval.
  insert into public.pact_extras_votes (round_id, user_id, vote) values (new_id, caller, 'approve');
  perform public.pact_extras_settle(new_id);
  return new_id;
end; $$;

-- Approved once every active member said yes; cancelled if anyone said not yet (the extras go back to unsent).
create or replace function public.pact_extras_settle(p_round_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare r public.pact_extras_rounds; members int; yes int; no int;
begin
  select * into r from public.pact_extras_rounds where round_id = p_round_id for update;
  if r.status <> 'open' then return; end if;
  select count(*) into members from public.pact_members where pact_id = r.pact_id and membership_status = 'active';
  select count(*) filter (where vote = 'approve'), count(*) filter (where vote = 'reject') into yes, no from public.pact_extras_votes where round_id = p_round_id;
  if no > 0 then
    update public.pact_extras_rounds set status = 'cancelled' where round_id = p_round_id;
    update public.pact_items set round_id = null where round_id = p_round_id;
  elsif yes >= members then
    update public.pact_extras_rounds set status = 'approved' where round_id = p_round_id;
  end if;
end; $$;

create or replace function public.vote_pact_extras(p_round_id uuid, p_approve boolean)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare r public.pact_extras_rounds; caller uuid;
begin
  select * into r from public.pact_extras_rounds where round_id = p_round_id;
  if r.round_id is null then raise exception 'Those extras are gone.'; end if;
  caller := public.pact_tab_require_member(r.pact_id);
  if r.status <> 'open' then raise exception 'That vote is already closed.'; end if;
  insert into public.pact_extras_votes (round_id, user_id, vote) values (p_round_id, caller, case when p_approve then 'approve' else 'reject' end)
  on conflict (round_id, user_id) do update set vote = excluded.vote, created_at = now();
  perform public.pact_extras_settle(p_round_id);
end; $$;

-- Called by "Pay extras" just before the send to the coordinator. Marks my own send only.
create or replace function public.mark_pact_extras_payment(p_round_id uuid, p_request_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare r public.pact_extras_rounds; caller uuid;
begin
  select * into r from public.pact_extras_rounds where round_id = p_round_id;
  if r.round_id is null or r.status <> 'approved' then raise exception 'These extras are not approved yet.'; end if;
  caller := public.pact_tab_require_member(r.pact_id);
  insert into public.pact_extras_payments (sender_id, request_id, round_id) values (caller, p_request_id, p_round_id)
  on conflict (sender_id, request_id) do nothing;
end; $$;

-- Everything the page needs: unsent extras, and each round with its items, votes and who has paid.
-- Paid means a confirmed send to the coordinator, marked for this round, of at least the share.
create or replace function public.get_pact_extras(p_pact_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare caller uuid := public.pact_tab_require_member(p_pact_id); host uuid;
begin
  select user_id into host from public.pact_members where pact_id = p_pact_id and role = 'host' and membership_status = 'active' limit 1;
  return jsonb_build_object(
    'host', host,
    'unsent', coalesce((select jsonb_agg(jsonb_build_object('item_id', i.item_id, 'kind', i.kind, 'title', i.title, 'price_each', i.price_each, 'link', i.link, 'created_by', i.created_by) order by i.created_at)
      from public.pact_items i where i.pact_id = p_pact_id and i.extra and i.round_id is null), '[]'::jsonb),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object(
        'round_id', r.round_id, 'status', r.status, 'share_cents', r.share_cents, 'created_at', r.created_at,
        'items', coalesce((select jsonb_agg(jsonb_build_object('title', i.title, 'kind', i.kind, 'price_each', i.price_each, 'link', i.link) order by i.created_at) from public.pact_items i where i.round_id = r.round_id), '[]'::jsonb),
        'votes', coalesce((select jsonb_object_agg(v.user_id, v.vote) from public.pact_extras_votes v where v.round_id = r.round_id), '{}'::jsonb),
        'paid', coalesce((select jsonb_agg(distinct t.sender_id) from public.pact_transfers t
            join public.pact_extras_payments x on x.sender_id = t.sender_id and x.request_id = t.request_id and x.round_id = r.round_id
            where t.pact_id = p_pact_id and t.recipient_id = host and t.status = 'confirmed' and t.amount_usdc * 100 >= r.share_cents), '[]'::jsonb)
      ) order by r.created_at desc) from public.pact_extras_rounds r where r.pact_id = p_pact_id and r.status <> 'cancelled'), '[]'::jsonb)
  );
end; $$;

revoke all on function public.send_pact_extras_for_approval(uuid), public.vote_pact_extras(uuid, boolean), public.mark_pact_extras_payment(uuid, uuid), public.get_pact_extras(uuid), public.pact_extras_settle(uuid) from public, anon;
grant execute on function public.send_pact_extras_for_approval(uuid), public.vote_pact_extras(uuid, boolean), public.mark_pact_extras_payment(uuid, uuid), public.get_pact_extras(uuid) to authenticated;
revoke execute on function public.pact_extras_settle(uuid) from authenticated;

commit;
