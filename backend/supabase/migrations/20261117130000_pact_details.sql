-- What a pact is for, beyond its name: the kind of plan, where, when, and the link to the thing being booked.
-- create_pact stays as it is so the website keeps working; the app saves these right after with set_pact_details.

alter table public.pacts
    add column pact_type text not null default 'trip' check (pact_type in ('trip', 'event', 'stay', 'dinner', 'other')),
    add column location text check (char_length(location) <= 120),
    add column starts_on date,
    add column ends_on date,
    add column link text check (link is null or link ~* '^https?://'),
    add constraint pacts_dates_in_order check (ends_on is null or starts_on is null or ends_on >= starts_on);

create or replace function public.set_pact_details(
    p_pact_id uuid,
    p_type text default 'trip',
    p_description text default null,
    p_location text default null,
    p_starts_on date default null,
    p_ends_on date default null,
    p_budget numeric default null,
    p_link text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not exists (
        select 1 from public.pact_members
        where pact_id = p_pact_id and user_id = auth.uid() and role = 'host' and membership_status = 'active'
    ) then
        raise exception 'Only the coordinator can change the pact details' using errcode = '42501';
    end if;

    update public.pacts
    set pact_type = coalesce(p_type, 'trip'),
        description = nullif(btrim(p_description), ''),
        location = nullif(btrim(p_location), ''),
        starts_on = p_starts_on,
        ends_on = p_ends_on,
        budget = p_budget,
        link = nullif(btrim(p_link), '')
    where pact_id = p_pact_id;
end;
$$;

revoke all on function public.set_pact_details(uuid, text, text, text, date, date, numeric, text) from public, anon;
grant execute on function public.set_pact_details(uuid, text, text, text, date, date, numeric, text) to authenticated;
