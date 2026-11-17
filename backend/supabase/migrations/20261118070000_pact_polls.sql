-- Vote cards: Grok (or anyone in the pact) puts 2 to 8 options to the group, like four hotels, and each person taps
-- the one they want. One vote each, which they can change. Separate from pact_decisions on purpose: those are the
-- approve/not-yet votes that drive booking, and a "pick a hotel" poll must never move a pact's booking stage.
begin;

create table public.pact_polls (
  poll_id uuid primary key default gen_random_uuid(),
  pact_id uuid not null references public.pacts(pact_id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  kind text not null default 'other' check (kind in ('stay', 'flight', 'ticket', 'dinner', 'other')),
  -- [{ "key": "1", "name": "...", "price_each": 222 | null, "link": "https://..." | null, "notes": "..." | null }]
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 8),
  status text not null default 'open' check (status in ('open', 'closed')),
  source text not null default 'manual' check (source in ('manual', 'grok')),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index pact_polls_pact_created_idx on public.pact_polls (pact_id, created_at);

create table public.pact_poll_votes (
  poll_id uuid not null references public.pact_polls(poll_id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  option_key text not null,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);

alter table public.pact_polls enable row level security;
alter table public.pact_poll_votes enable row level security;
revoke all on table public.pact_polls, public.pact_poll_votes from public, anon, authenticated;
grant select on table public.pact_polls, public.pact_poll_votes to authenticated;

create policy "Members see their pacts' polls"
on public.pact_polls for select to authenticated
using (exists (select 1 from public.pact_members m where m.pact_id = pact_polls.pact_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));

create policy "Members see votes on their pacts' polls"
on public.pact_poll_votes for select to authenticated
using (exists (select 1 from public.pact_polls p join public.pact_members m on m.pact_id = p.pact_id
  where p.poll_id = pact_poll_votes.poll_id and m.user_id = (select auth.uid()) and m.membership_status = 'active'));

-- Starts a poll. Options are cleaned and numbered here, so the cards never trust the caller's shape.
create or replace function public.create_pact_poll(p_pact_id uuid, p_title text, p_options jsonb, p_kind text default 'other', p_source text default 'manual')
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  clean jsonb := '[]'::jsonb;
  o jsonb; n integer := 0; price numeric; link text; name text;
  result uuid;
begin
  if caller is null or not exists (select 1 from public.pact_members m where m.pact_id = p_pact_id and m.user_id = caller and m.membership_status = 'active') then
    raise exception 'Only people in this pact can start a vote' using errcode = '42501';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 120 then raise exception 'A vote needs a title of 1 to 120 characters'; end if;
  if p_options is null or jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) not between 2 and 8 then raise exception 'A vote needs 2 to 8 options'; end if;
  for o in select * from jsonb_array_elements(p_options) loop
    n := n + 1;
    name := btrim(coalesce(o->>'name', ''));
    if char_length(name) not between 1 and 120 then raise exception 'Option % needs a name', n; end if;
    price := case when jsonb_typeof(o->'price_each') = 'number' and (o->>'price_each')::numeric >= 0 and (o->>'price_each')::numeric <= 1000000
                  then round((o->>'price_each')::numeric, 2) end;
    link := nullif(btrim(coalesce(o->>'link', '')), '');
    if link is not null and link !~* '^https?://' then link := null; end if;
    clean := clean || jsonb_build_object('key', n::text, 'name', name, 'price_each', price, 'link', left(link, 500),
      'notes', nullif(left(btrim(coalesce(o->>'notes', '')), 240), ''));
  end loop;
  insert into public.pact_polls (pact_id, title, kind, options, source, created_by)
  values (p_pact_id, btrim(p_title), case when p_kind in ('stay', 'flight', 'ticket', 'dinner', 'other') then p_kind else 'other' end,
          clean, case when p_source = 'grok' then 'grok' else 'manual' end, caller)
  returning poll_id into result;
  return result;
end; $$;

-- My vote; voting again moves it. Tapping the one I already picked takes the vote back.
create or replace function public.vote_pact_poll(p_poll_id uuid, p_option_key text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare caller uuid := auth.uid(); poll public.pact_polls;
begin
  select * into poll from public.pact_polls where poll_id = p_poll_id;
  if poll.poll_id is null or caller is null or not exists (select 1 from public.pact_members m where m.pact_id = poll.pact_id and m.user_id = caller and m.membership_status = 'active') then
    raise exception 'Only people in this pact can vote' using errcode = '42501';
  end if;
  if poll.status <> 'open' then raise exception 'This vote is closed'; end if;
  if not exists (select 1 from jsonb_array_elements(poll.options) o where o->>'key' = p_option_key) then raise exception 'That option is not in this vote'; end if;
  if exists (select 1 from public.pact_poll_votes v where v.poll_id = p_poll_id and v.user_id = caller and v.option_key = p_option_key) then
    delete from public.pact_poll_votes where poll_id = p_poll_id and user_id = caller;
  else
    insert into public.pact_poll_votes (poll_id, user_id, option_key) values (p_poll_id, caller, p_option_key)
    on conflict (poll_id, user_id) do update set option_key = excluded.option_key, created_at = now();
  end if;
end; $$;

-- The person who started it (or the coordinator) closes it.
create or replace function public.close_pact_poll(p_poll_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare caller uuid := auth.uid(); poll public.pact_polls;
begin
  select * into poll from public.pact_polls where poll_id = p_poll_id;
  if poll.poll_id is null or not (poll.created_by = caller or exists (select 1 from public.pact_members m where m.pact_id = poll.pact_id and m.user_id = caller and m.role = 'host' and m.membership_status = 'active')) then
    raise exception 'Only whoever started the vote, or the coordinator, can close it' using errcode = '42501';
  end if;
  update public.pact_polls set status = 'closed' where poll_id = p_poll_id;
end; $$;

revoke all on function public.create_pact_poll(uuid, text, jsonb, text, text), public.vote_pact_poll(uuid, text), public.close_pact_poll(uuid) from public, anon;
grant execute on function public.create_pact_poll(uuid, text, jsonb, text, text), public.vote_pact_poll(uuid, text), public.close_pact_poll(uuid) to authenticated;

commit;
