-- Some things are bought once for the whole group (a domain, a house, a car); their price is split between everyone.
-- Others are per person (tickets, meals). Items and vote options say which, so each person's share is right.
begin;

alter table public.pact_items add column if not exists price_scope text not null default 'each' check (price_scope in ('each', 'group'));

-- Same as before, and it keeps each option's price_for ('each' or 'group').
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
      'notes', nullif(left(btrim(coalesce(o->>'notes', '')), 240), ''),
      'price_for', case when o->>'price_for' = 'group' then 'group' else 'each' end);
  end loop;
  insert into public.pact_polls (pact_id, title, kind, options, source, created_by)
  values (p_pact_id, btrim(p_title), case when p_kind in ('stay', 'flight', 'ticket', 'dinner', 'other') then p_kind else 'other' end,
          clean, case when p_source = 'grok' then 'grok' else 'manual' end, caller)
  returning poll_id into result;
  return result;
end; $$;

commit;
