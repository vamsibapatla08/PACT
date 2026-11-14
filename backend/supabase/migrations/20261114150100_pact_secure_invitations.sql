-- Apply after the Pact core schema. Assumes pacts.pact_id and
-- pact_members(pact_id, user_id) with role and membership_status.
-- See the preflight and frontend contract before deploying.
begin;

create schema if not exists pact_internal;
revoke all on schema pact_internal from public, anon, authenticated;

create table pact_internal.invitations (
    invitation_id uuid primary key default pg_catalog.gen_random_uuid(),
    pact_id uuid not null references public.pacts(pact_id) on delete cascade,
    code_hash bytea not null unique check (pg_catalog.octet_length(code_hash) = 32),
    issued_by uuid not null,
    expires_at timestamptz not null,
    revoked_at timestamptz,
    redeemed_by uuid
);
alter table pact_internal.invitations enable row level security;
revoke all on pact_internal.invitations from public, anon, authenticated;

create function public.create_pact_invitation(p_pact_id uuid)
returns table (invitation_id uuid, invite_code text, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare
    caller uuid := auth.uid();
    code text;
begin
    if caller is null then
        raise exception 'Sign in first' using errcode = '42501';
    end if;

    perform 1 from public.pact_members as m
    where m.pact_id = p_pact_id and m.user_id = caller
      and m.role = 'host' and m.membership_status = 'active'
    for share;
    if not found then
        raise exception 'Active host required' using errcode = '42501';
    end if;

    code := pg_catalog.replace(
        pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text,
        '-', ''
    );

    return query
    insert into pact_internal.invitations as i
        (pact_id, code_hash, issued_by, expires_at)
    values (
        p_pact_id, pg_catalog.sha256(pg_catalog.convert_to(code, 'UTF8')),
        caller, pg_catalog.clock_timestamp() + interval '24 hours'
    )
    returning i.invitation_id, code, i.expires_at;
end;
$$;

create function public.revoke_pact_invitation(p_invitation_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
    caller uuid := auth.uid();
begin
    if caller is null then
        raise exception 'Sign in first' using errcode = '42501';
    end if;

    update pact_internal.invitations as i
    set revoked_at = pg_catalog.clock_timestamp()
    where i.invitation_id = p_invitation_id
      and i.revoked_at is null and i.redeemed_by is null
      and exists (
          select 1 from public.pact_members as m
          where m.pact_id = i.pact_id and m.user_id = caller
            and m.role = 'host' and m.membership_status = 'active'
          for share
      );
    return found;
end;
$$;

create function public.join_pact(p_invite_code text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
    caller uuid := auth.uid();
    code text := pg_catalog.lower(pg_catalog.btrim(p_invite_code));
    invite pact_internal.invitations%rowtype;
begin
    if caller is null then
        raise exception 'Sign in first' using errcode = '42501';
    end if;

    if code is null or code !~ '^[0-9a-f]{64}$' then
        raise exception 'Invitation unavailable' using errcode = '22023';
         end if;

    select i.* into invite
    from pact_internal.invitations as i
    where i.code_hash = pg_catalog.sha256(pg_catalog.convert_to(code, 'UTF8'))
    for update;

    if not found or invite.revoked_at is not null
       or invite.expires_at <= pg_catalog.clock_timestamp()
       or (invite.redeemed_by is not null and invite.redeemed_by <> caller) then
        raise exception 'Invitation unavailable' using errcode = '22023';
    end if;

    if invite.redeemed_by is null then
        perform 1 from public.pact_members as m
        where m.pact_id = invite.pact_id and m.user_id = invite.issued_by
          and m.role = 'host' and m.membership_status = 'active'
        for share;
        if not found then
            raise exception 'Invitation unavailable' using errcode = '22023';
        end if;

        insert into public.pact_members (pact_id, user_id, role, membership_status)
        values (invite.pact_id, caller, 'member', 'active')
        on conflict (pact_id, user_id) do nothing;
    end if;

    -- Existing active members keep their role. Inactive memberships
    -- require a separate reactivation workflow.
    perform 1 from public.pact_members as m
    where m.pact_id = invite.pact_id and m.user_id = caller
      and m.membership_status = 'active'
    for share;
    if not found then
        raise exception 'Invitation unavailable' using errcode = '22023';
    end if;

    if invite.redeemed_by is null and caller <> invite.issued_by then
        update pact_internal.invitations
        set redeemed_by = caller
        where invitation_id = invite.invitation_id;
    end if;

    return invite.pact_id;
end;
$$;

create function public.list_pact_members(p_pact_id uuid)
returns table (user_id uuid, role text, name text)
language sql stable security definer set search_path = ''
as $$
    select m.user_id, m.role, p.name
    from public.pact_members as m
    left join public.profiles as p on p.id = m.user_id
    where m.pact_id = p_pact_id and m.membership_status = 'active'
      and exists (
          select 1 from public.pact_members as viewer
          where viewer.pact_id = p_pact_id and viewer.user_id = auth.uid()
            and viewer.membership_status = 'active'
      )
    order by m.joined_at, m.user_id;
$$;

revoke all on function
    public.create_pact_invitation(uuid), public.revoke_pact_invitation(uuid),
    public.join_pact(text), public.list_pact_members(uuid)
from public, anon, authenticated;
grant execute on function
    public.create_pact_invitation(uuid), public.revoke_pact_invitation(uuid),
    public.join_pact(text), public.list_pact_members(uuid)
to authenticated;

commit;
