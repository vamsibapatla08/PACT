-- Pact Pilot conversations: each question you ask Pact Pilot in a pact, and its answer.
-- Private to the person who asked. Nobody else in the pact can read them.

create table if not exists public.pact_pilot_messages (
  message_id uuid primary key default gen_random_uuid(),
  pact_id uuid not null references public.pacts(pact_id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  question text not null check (btrim(question) <> '' and char_length(question) <= 2000),
  reply text not null check (char_length(reply) <= 20000),
  actions jsonb not null default '[]'::jsonb check (jsonb_typeof(actions) = 'array'),
  operation_id uuid references public.pact_ai_operations(operation_id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists pact_pilot_messages_mine on public.pact_pilot_messages (pact_id, user_id, created_at desc);

alter table public.pact_pilot_messages enable row level security;

-- You read and save only your own, and only in pacts you are still in.
create policy "Members read their own Pact Pilot messages" on public.pact_pilot_messages
  for select to authenticated
  using (user_id = (select auth.uid()) and exists (
    select 1 from public.pact_members m
    where m.pact_id = pact_pilot_messages.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));

create policy "Members save their own Pact Pilot messages" on public.pact_pilot_messages
  for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (
    select 1 from public.pact_members m
    where m.pact_id = pact_pilot_messages.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));

-- Clear your own conversation.
create policy "Members delete their own Pact Pilot messages" on public.pact_pilot_messages
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, delete on public.pact_pilot_messages to authenticated;
