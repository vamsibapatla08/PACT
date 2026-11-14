begin;

-- One Circle wallet on the Arc test network per user.
-- Only the wallet Edge Function writes here, using the service role.
create table public.wallets (
    user_id uuid primary key references auth.users(id) on delete cascade,
    circle_wallet_id text not null unique,
    address text not null unique check (address ~ '^0x[0-9a-fA-F]{40}$'),
    blockchain text not null default 'ARC-TESTNET',
    created_at timestamptz not null default now()
);

alter table public.wallets enable row level security;

revoke all privileges on table public.wallets from public, anon, authenticated;

grant select on table public.wallets to authenticated;

create policy "Read own wallet"
on public.wallets
for select
to authenticated
using (user_id = (select auth.uid()));

commit;
