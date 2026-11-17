-- The things a pact is booking, one row each: a stay, a flight, tickets, a dinner. Together they are the itinerary,
-- and their prices each add up to what everyone pays. Members add them by hand or with Grok; items lock once a
-- split is set up, so the amount people approved can't change underneath them.

create table public.pact_items (
    item_id uuid primary key default gen_random_uuid(),
    pact_id uuid not null references public.pacts(pact_id) on delete cascade,
    kind text not null check (kind in ('stay', 'flight', 'ticket', 'dinner', 'other')),
    title text not null check (char_length(btrim(title)) between 1 and 120),
    location text check (char_length(location) <= 120),
    starts_on date,
    ends_on date,
    link text check (link is null or link ~* '^https?://'),
    price_each numeric(12, 2) check (price_each >= 0),
    source text not null default 'manual' check (source in ('manual', 'grok')),
    created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create index pact_items_pact_idx on public.pact_items (pact_id, starts_on);

alter table public.pact_items enable row level security;
revoke all on table public.pact_items from public, anon, authenticated;
grant select, insert, delete on table public.pact_items to authenticated;

create policy "Members read their pacts' items"
on public.pact_items for select to authenticated
using (exists (
    select 1 from public.pact_members m
    where m.pact_id = pact_items.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'
));

create policy "Members add items until the split is set up"
on public.pact_items for insert to authenticated
with check (
    created_by = (select auth.uid())
    and exists (
        select 1 from public.pact_members m
        where m.pact_id = pact_items.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'
    )
    and not exists (select 1 from public.pact_payments p where p.pact_id = pact_items.pact_id)
);

create policy "The adder or the coordinator removes items until the split is set up"
on public.pact_items for delete to authenticated
using (
    not exists (select 1 from public.pact_payments p where p.pact_id = pact_items.pact_id)
    and (
        created_by = (select auth.uid())
        or exists (
            select 1 from public.pact_members m
            where m.pact_id = pact_items.pact_id and m.user_id = (select auth.uid())
              and m.role = 'host' and m.membership_status = 'active'
        )
    )
);
