-- Pact core: who people are, the pacts they make, and who is in each one.
-- Chat, plans, votes and payments come in later migrations.

-- 1. Profiles: one row per signed-in user, made automatically on Google sign-in.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  wallet_address text unique, -- Circle wallet on the Arc test network
  created_at timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2. Pacts: a group planning something together.

create table public.pacts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_by uuid not null default auth.uid() references public.profiles (id),
  invite_code text not null unique default substr(md5(random()::text), 1, 8),
  created_at timestamptz not null default now()
);

-- 3. Members: who is in a pact. The host approves anyone who handles money.

create table public.pact_members (
  pact_id uuid not null references public.pacts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('host', 'member')),
  can_handle_money boolean not null default false,
  spend_cap_usdc numeric(18, 6) check (spend_cap_usdc >= 0),
  joined_at timestamptz not null default now(),
  primary key (pact_id, user_id)
);

create index pact_members_user_id_idx on public.pact_members (user_id);

-- Whoever creates a pact becomes its host.
create function public.add_pact_host()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.pact_members (pact_id, user_id, role, can_handle_money)
  values (new.id, new.created_by, 'host', true);
  return new;
end;
$$;

create trigger on_pact_created
  after insert on public.pacts
  for each row execute function public.add_pact_host();

-- 4. Helpers for the access rules below. Security definer so the rules on
-- pact_members can use them without looping back on themselves.

create function public.is_pact_member(p_pact_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pact_members
    where pact_id = p_pact_id and user_id = (select auth.uid())
  );
$$;

create function public.is_pact_host(p_pact_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pact_members
    where pact_id = p_pact_id and user_id = (select auth.uid()) and role = 'host'
  );
$$;

-- Join a pact from an invite link. Call with supabase.rpc('join_pact', { p_invite_code }).
create function public.join_pact(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pact_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;

  select id into v_pact_id from public.pacts where invite_code = p_invite_code;
  if v_pact_id is null then
    raise exception 'Invite code not found';
  end if;

  insert into public.pact_members (pact_id, user_id)
  values (v_pact_id, auth.uid())
  on conflict (pact_id, user_id) do nothing;

  return v_pact_id;
end;
$$;

-- 5. Access rules (row level security).

alter table public.profiles enable row level security;
alter table public.pacts enable row level security;
alter table public.pact_members enable row level security;

create policy "See yourself and people in your pacts"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1
      from public.pact_members mine
      join public.pact_members theirs on theirs.pact_id = mine.pact_id
      where mine.user_id = (select auth.uid()) and theirs.user_id = profiles.id
    )
  );

create policy "Edit your own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "See pacts you are in"
  on public.pacts for select to authenticated
  using (created_by = (select auth.uid()) or public.is_pact_member(id));

create policy "Create a pact as yourself"
  on public.pacts for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy "Host edits the pact"
  on public.pacts for update to authenticated
  using (public.is_pact_host(id));

create policy "Host deletes the pact"
  on public.pacts for delete to authenticated
  using (public.is_pact_host(id));

create policy "See members of your pacts"
  on public.pact_members for select to authenticated
  using (public.is_pact_member(pact_id));

create policy "Host manages members"
  on public.pact_members for update to authenticated
  using (public.is_pact_host(pact_id));

create policy "Host removes members, or you leave"
  on public.pact_members for delete to authenticated
  using (public.is_pact_host(pact_id) or user_id = (select auth.uid()));
