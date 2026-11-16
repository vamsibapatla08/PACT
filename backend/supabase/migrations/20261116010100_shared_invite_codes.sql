begin;

-- An invite code is shared in a group chat, so it now lets in everyone who has it until it expires
-- (24 hours) or the host revokes it. It used to stop working after the first person joined.
create or replace function public.join_pact(p_invite_code text)
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
    where i.code_hash = pg_catalog.sha256(pg_catalog.convert_to(code, 'UTF8'));

    if not found or invite.revoked_at is not null or invite.expires_at <= pg_catalog.clock_timestamp() then
        raise exception 'Invitation unavailable' using errcode = '22023';
    end if;

    -- The host who made the code must still be the active host.
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

    -- Existing active members keep their role. Inactive memberships
    -- require a separate reactivation workflow.
    perform 1 from public.pact_members as m
    where m.pact_id = invite.pact_id and m.user_id = caller
      and m.membership_status = 'active';
    if not found then
        raise exception 'Invitation unavailable' using errcode = '22023';
    end if;

    return invite.pact_id;
end;
$$;

commit;
