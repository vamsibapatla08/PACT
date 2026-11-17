begin;

create or replace function public.create_pact_booking_split(p_booking_id uuid, p_proposal_id uuid, p_split_type text default 'equal', p_custom_items jsonb default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); b public.pact_bookings; p public.pact_booking_proposals; result uuid; version integer; total_members integer; per_share bigint; remainder bigint; position integer; item jsonb; item_user uuid; item_amount bigint; custom_total bigint := 0;
begin
  select b0.* into b from public.pact_bookings b0 join public.pact_members m on m.pact_id=b0.pact_id and m.user_id=caller and m.membership_status='active' where b0.booking_id=p_booking_id for update;
  if not found then raise exception 'Active Pact membership required' using errcode='42501'; end if;
  select p0.* into p from public.pact_booking_proposals p0 where p0.proposal_id=p_proposal_id and p0.booking_id=p_booking_id;
  if not found or p.quote_expires_at <= now() then raise exception 'Booking proposal is missing or expired'; end if;
  if exists (select 1 from public.pact_booking_approvals where proposal_id=p_proposal_id and decision='reject') or (select count(*) from public.pact_booking_approvals where proposal_id=p_proposal_id and decision='approve') <> (select count(*) from public.pact_booking_required_members where proposal_id=p_proposal_id) then raise exception 'Every active member must approve the booking proposal first'; end if;
  if p_split_type not in ('equal','custom') then raise exception 'Invalid split type'; end if;
  select count(*) into total_members from public.pact_booking_required_members where proposal_id=p_proposal_id;
  if total_members < 1 then raise exception 'No eligible booking members'; end if;
  select coalesce(max(split_version),0)+1 into version from public.pact_booking_splits where booking_id=p_booking_id;
  insert into public.pact_booking_splits(booking_id,proposal_id,split_version,split_type,total_cents,currency,created_by) values(p_booking_id,p_proposal_id,version,p_split_type,p.total_cents,p.currency,caller) returning split_id into result;
  if p_split_type = 'equal' then
    per_share := p.total_cents / total_members; remainder := p.total_cents % total_members; position := 0;
    for item_user in select user_id from public.pact_booking_required_members where proposal_id=p_proposal_id order by user_id loop
      position := position + 1;
      insert into public.pact_booking_split_items(split_id,user_id,amount_cents) values(result,item_user,per_share + case when position <= remainder then 1 else 0 end);
    end loop;
  else
    if p_custom_items is null or jsonb_typeof(p_custom_items) <> 'array' or jsonb_array_length(p_custom_items) <> total_members then raise exception 'Custom split must include every eligible member'; end if;
    for item in select value from jsonb_array_elements(p_custom_items) loop
      item_user := (item->>'user_id')::uuid; item_amount := (item->>'amount_cents')::bigint;
      if item_amount is null or item_amount <= 0 or not exists (select 1 from public.pact_booking_required_members where proposal_id=p_proposal_id and user_id=item_user) or exists (select 1 from public.pact_booking_split_items where split_id=result and user_id=item_user) then raise exception 'Invalid custom split member or amount'; end if;
      custom_total := custom_total + item_amount;
      insert into public.pact_booking_split_items(split_id,user_id,amount_cents) values(result,item_user,item_amount);
    end loop;
    if custom_total <> p.total_cents then raise exception 'Split amounts must equal the quoted total'; end if;
  end if;
  update public.pact_bookings set status='awaiting_split_approval',updated_at=now() where booking_id=p_booking_id;
  return result;
end; $$;

create or replace function public.cast_pact_booking_split_approval(p_split_id uuid, p_decision text) returns public.pact_booking_splits language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); s public.pact_booking_splits; required_count integer; approval_count integer; rejected boolean;
begin
  if p_decision not in ('approve','reject') then raise exception 'Invalid split approval'; end if;
  select s0.* into s from public.pact_booking_splits s0 join public.pact_booking_required_members r on r.proposal_id=s0.proposal_id and r.user_id=caller where s0.split_id=p_split_id for update;
  if not found then raise exception 'Eligible booking member required' using errcode='42501'; end if;
  insert into public.pact_booking_split_approvals(split_id,user_id,decision) values(p_split_id,caller,p_decision);
  select count(*) into required_count from public.pact_booking_required_members where proposal_id=s.proposal_id;
  select count(*) filter (where decision='approve'), bool_or(decision='reject') into approval_count,rejected from public.pact_booking_split_approvals where split_id=p_split_id;
  if rejected then update public.pact_booking_splits set status='rejected' where split_id=p_split_id; update public.pact_bookings set status='draft',updated_at=now() where booking_id=s.booking_id; elsif approval_count=required_count then update public.pact_booking_splits set status='approved' where split_id=p_split_id; update public.pact_bookings set status='awaiting_funding',updated_at=now() where booking_id=s.booking_id; end if;
  return s;
end; $$;

revoke all on function public.create_pact_booking_split(uuid,uuid,text,jsonb), public.cast_pact_booking_split_approval(uuid,text) from public, anon;
grant execute on function public.create_pact_booking_split(uuid,uuid,text,jsonb), public.cast_pact_booking_split_approval(uuid,text) to authenticated;

commit;
