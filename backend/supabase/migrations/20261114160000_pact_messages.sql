begin;

create table public.pact_messages (
    message_id uuid primary key default gen_random_uuid(),
    pact_id uuid not null references public.pacts(pact_id) on delete cascade,
    sender_id uuid not null default auth.uid() references auth.users(id),
    body text not null,
    created_at timestamptz not null default now(),

    constraint pact_messages_body_check
        check (body ~ '[^[:space:]]' and char_length(body) <= 2000)
);

create index pact_messages_history_idx
    on public.pact_messages (pact_id, created_at, message_id);

alter table public.pact_messages enable row level security;

revoke all privileges on table public.pact_messages
    from public, anon, authenticated;

grant select on table public.pact_messages to authenticated;
grant insert (pact_id, body) on table public.pact_messages to authenticated;

create policy "Active members can read messages"
on public.pact_messages
for select
to authenticated
using (
    exists (
        select 1
        from public.pact_members as m
        where m.pact_id = pact_messages.pact_id
          and m.user_id = (select auth.uid())
          and m.membership_status = 'active'
    )
);

create policy "Active members can send their own messages"
on public.pact_messages
for insert
to authenticated
with check (
    sender_id = (select auth.uid())
    and exists (
        select 1
        from public.pact_members as m
        where m.pact_id = pact_messages.pact_id
          and m.user_id = (select auth.uid())
          and m.membership_status = 'active'
    )
);

alter publication supabase_realtime add table public.pact_messages;

commit;