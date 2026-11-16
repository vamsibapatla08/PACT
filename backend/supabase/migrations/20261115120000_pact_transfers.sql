begin;

-- USDC sends from one Pact member to another on the Arc test network.
-- Only the wallet Edge Function writes here, using the service role, so nobody can mark their own send confirmed.
create table public.pact_transfers (
    transfer_id uuid primary key default gen_random_uuid(),
    pact_id uuid not null references public.pacts(pact_id) on delete cascade,
    sender_id uuid not null references auth.users(id) on delete cascade,
    recipient_id uuid not null references auth.users(id) on delete cascade,
    recipient_address text not null check (recipient_address ~ '^0x[0-9a-fA-F]{40}$'),
    amount_usdc numeric(18, 6) not null check (amount_usdc > 0),
    -- Made by the app once per Send tap, so a retry or double tap can't send twice.
    request_id uuid not null,
    circle_challenge_id text,
    circle_transaction_id text,
    tx_hash text,
    status text not null default 'awaiting_pin'
        check (status in ('awaiting_pin', 'pending', 'confirmed', 'failed')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (sender_id, request_id),
    check (sender_id <> recipient_id)
);

create index pact_transfers_pact_id_idx on public.pact_transfers (pact_id);
create index pact_transfers_recipient_id_idx on public.pact_transfers (recipient_id);

alter table public.pact_transfers enable row level security;

revoke all privileges on table public.pact_transfers from public, anon, authenticated;

grant select on table public.pact_transfers to authenticated;

-- Bypassing RLS does not bypass grants on the live project, so grant exactly what the function uses.
grant select, insert, update on table public.pact_transfers to service_role;

create policy "Read transfers you sent or received"
on public.pact_transfers
for select
to authenticated
using (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()));

commit;
