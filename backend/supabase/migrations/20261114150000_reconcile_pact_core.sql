begin;

-- Remove the old triggers before renaming the columns they use.
drop trigger on_auth_user_created on auth.users;
drop function public.handle_new_user();

drop trigger on_pact_created on public.pacts;
drop function public.add_pact_host();

-- The next migration installs the secure replacement.
drop function public.join_pact(text);

-- Align profiles with the live schema.
alter table public.profiles
    rename column full_name to name;

alter table public.profiles
    add column email text;

-- Align Pacts with the live schema.
alter table public.pacts
    rename column id to pact_id;

alter table public.pacts
    add column description text,
    add column budget numeric(12, 2) check (budget >= 0),
    add column status text not null default 'draft',
    alter column invite_code drop default,
    alter column invite_code drop not null,
    alter column created_by drop default,
    drop constraint pacts_created_by_fkey,
    add constraint pacts_created_by_fkey
        foreign key (created_by) references auth.users(id);

-- The existing Pact foreign key follows the primary-key column rename.
alter table public.pact_members
    add column membership_status text not null default 'active',
    add column name text,
    add column created_by uuid references auth.users(id) on delete set null,
    alter column role drop default,
    drop constraint pact_members_user_id_fkey,
    add constraint pact_members_user_id_fkey
        foreign key (user_id) references auth.users(id) on delete cascade;

-- Remove old policies before dropping the functions they reference.
drop policy "See yourself and people in your pacts" on public.profiles;
drop policy "Edit your own profile" on public.profiles;

drop policy "See pacts you are in" on public.pacts;
drop policy "Create a pact as yourself" on public.pacts;
drop policy "Host edits the pact" on public.pacts;
drop policy "Host deletes the pact" on public.pacts;

drop policy "See members of your pacts" on public.pact_members;
drop policy "Host manages members" on public.pact_members;
drop policy "Host removes members, or you leave" on public.pact_members;

drop function public.is_pact_member(uuid);
drop function public.is_pact_host(uuid);

-- Match the direct table access used by the app.
alter table public.profiles enable row level security;
alter table public.pacts enable row level security;
alter table public.pact_members enable row level security;

revoke all privileges on table
    public.profiles,
    public.pacts,
    public.pact_members
from public, anon, authenticated;

grant select on table
    public.profiles,
    public.pacts,
    public.pact_members
to authenticated;

create policy "Read own profile"
on public.profiles
for select
to authenticated
using (id = (select auth.uid()));

create policy "Read own memberships"
on public.pact_members
for select
to authenticated
using (user_id = (select auth.uid()));

create policy "Read active member pacts"
on public.pacts
for select
to authenticated
using (
    exists (
        select 1
        from public.pact_members as membership
        where membership.pact_id = pacts.pact_id
          and membership.user_id = (select auth.uid())
          and membership.membership_status = 'active'
    )
);

-- Create the Pact and its host membership in the same transaction.
create function public.create_pact(
    p_name text,
    p_description text default null,
    p_budget numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller_id uuid := auth.uid();
    new_pact_id uuid;
begin
    if caller_id is null then
        raise exception 'Sign in before creating a Pact'
            using errcode = '42501';
    end if;

    insert into public.pacts (name, description, budget, created_by)
    values (p_name, p_description, p_budget, caller_id)
    returning pact_id into new_pact_id;

    insert into public.pact_members (
        pact_id,
        user_id,
        role,
        membership_status
    )
    values (new_pact_id, caller_id, 'host', 'active');

    return new_pact_id;
end;
$$;

revoke execute on function public.create_pact(text, text, numeric)
    from public, anon;

grant execute on function public.create_pact(text, text, numeric)
    to authenticated;

commit;