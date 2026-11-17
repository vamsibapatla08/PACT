-- The coordinator can rename the pact from its page. Pacts are written through functions only, so this is one too.

create or replace function public.rename_pact(p_pact_id uuid, p_name text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare clean text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if not exists (select 1 from public.pact_members m where m.pact_id = p_pact_id and m.user_id = auth.uid() and m.role = 'host' and m.membership_status = 'active') then
    raise exception 'Only the coordinator can rename this pact' using errcode = '42501';
  end if;
  if char_length(clean) < 1 or char_length(clean) > 80 then
    raise exception 'A pact name is 1 to 80 characters';
  end if;
  update public.pacts set name = clean where pact_id = p_pact_id;
  return clean;
end; $$;

revoke all on function public.rename_pact(uuid, text) from public, anon;
grant execute on function public.rename_pact(uuid, text) to authenticated;
