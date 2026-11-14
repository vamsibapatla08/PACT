-- Run after reviewing the live preflight in pact_google_profiles.md.
-- This draft replaces the previously shared name-only roster signature.
begin;

-- Reuse the private schema created by the invitation migration.
revoke all on schema pact_internal from public, anon, authenticated;

create function pact_internal.sync_google_profile(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
    insert into public.profiles as profile (id, name, email, avatar_url)
    select u.id,
           coalesce(nullif(btrim(g.identity_data ->> 'full_name'), ''),
                    nullif(btrim(g.identity_data ->> 'name'), '')),
           nullif(btrim(u.email), ''),
           coalesce(nullif(btrim(g.identity_data ->> 'avatar_url'), ''),
                    nullif(btrim(g.identity_data ->> 'picture'), ''))
    from auth.users as u
    cross join lateral (
        select i.identity_data
        from auth.identities as i
        where i.user_id = u.id and i.provider = 'google'
        order by i.last_sign_in_at desc nulls last, i.id
        limit 1
    ) as g
    where u.id = p_user_id
    on conflict (id) do update
    set name = case when nullif(btrim(profile.name), '') is null
                    then excluded.name else profile.name end,
        email = case when nullif(btrim(profile.email), '') is null
                     then excluded.email else profile.email end,
        avatar_url = case when nullif(btrim(profile.avatar_url), '') is null
                          then excluded.avatar_url else profile.avatar_url end
    where (nullif(btrim(profile.name), '') is null and excluded.name is not null)
       or (nullif(btrim(profile.email), '') is null and excluded.email is not null)
       or (nullif(btrim(profile.avatar_url), '') is null and excluded.avatar_url is not null);
$$;

create function pact_internal.sync_google_identity_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform pact_internal.sync_google_profile(new.user_id);
    return new;
end;
$$;

-- The team's previously discussed trigger was profile-only. If live inspection
-- finds other behavior in it, migrate that behavior before using this script.
drop trigger if exists on_auth_user_created on auth.users;

create trigger pact_sync_google_identity
after insert or update on auth.identities
for each row
when (new.provider = 'google')
execute function pact_internal.sync_google_identity_trigger();

-- Explicit repair on session initialization also covers a returning session
-- that did not update its Google identity row.
create function public.sync_my_google_profile()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null then
        raise exception 'Sign in first' using errcode = '42501';
    end if;
    perform pact_internal.sync_google_profile(auth.uid());
end;
$$;

revoke all on function pact_internal.sync_google_profile(uuid),
    pact_internal.sync_google_identity_trigger(), public.sync_my_google_profile()
from public, anon, authenticated;
grant execute on function public.sync_my_google_profile() to authenticated;

-- Backfill all users with a linked Google identity through the same code path.
do $$
declare
    account_id uuid;
begin
    for account_id in
        select distinct i.user_id from auth.identities as i where i.provider = 'google'
    loop
        perform pact_internal.sync_google_profile(account_id);
    end loop;
end;
$$;

-- PostgreSQL requires dropping the old signature to change its output columns.
-- RESTRICT intentionally stops the migration if another database object depends on it.
drop function public.list_pact_members(uuid) restrict;

create function public.list_pact_members(p_pact_id uuid)
returns table (user_id uuid, role text, name text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
    select m.user_id, m.role, p.name, p.avatar_url
    from public.pact_members as m
    left join public.profiles as p on p.id = m.user_id
    where m.pact_id = p_pact_id
      and m.membership_status = 'active'
      and exists (
          select 1 from public.pact_members as viewer
          where viewer.pact_id = p_pact_id
            and viewer.user_id = auth.uid()
            and viewer.membership_status = 'active'
      )
    order by m.joined_at, m.user_id;
$$;

revoke all on function public.list_pact_members(uuid) from public, anon, authenticated;
grant execute on function public.list_pact_members(uuid) to authenticated;

commit;
