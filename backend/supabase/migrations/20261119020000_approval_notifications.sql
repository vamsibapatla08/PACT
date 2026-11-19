-- Sending a plan for approval: never twice at once, and everyone who needs to approve gets an email.
begin;

-- One plan up for approval at a time. Two sends within a few seconds (two taps, two tabs) are the same send, so the
-- second is refused. A newer plan sent later replaces an older one still waiting.
create or replace function public.one_open_plan_decision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.recommendation_id is null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('pact_plan_decision:' || new.pact_id::text));
  if exists (select 1 from public.pact_decisions where pact_id = new.pact_id and recommendation_id is not null
             and status = 'open' and created_at > now() - interval '10 seconds') then
    raise exception 'This plan is already up for approval';
  end if;
  update public.pact_decisions set status = 'rejected'
  where pact_id = new.pact_id and recommendation_id is not null and status = 'open';
  return new;
end; $$;
drop trigger if exists pact_one_open_plan_decision on public.pact_decisions;
create trigger pact_one_open_plan_decision before insert on public.pact_decisions
for each row execute function public.one_open_plan_decision();

-- "Approve the plan" emails.
alter table public.pact_email_outbox drop constraint if exists pact_email_outbox_email_type_check;
alter table public.pact_email_outbox add constraint pact_email_outbox_email_type_check
  check (email_type in ('demo_itinerary', 'verified_payment_receipt', 'pact_booked', 'approval_needed'));

create or replace function public.enqueue_approval_needed_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.recommendation_id is not null and new.status = 'open' then
    insert into public.pact_email_outbox (pact_id, recipient_user_id, email_type, entity_id, payload)
    select new.pact_id, m.user_id, 'approval_needed', new.decision_id,
      jsonb_build_object('decision_id', new.decision_id, 'recommendation_id', new.recommendation_id)
    from public.pact_members m
    where m.pact_id = new.pact_id and m.membership_status = 'active' and m.user_id is distinct from new.created_by
    on conflict (email_type, entity_id, recipient_user_id) do nothing;
  end if;
  return new;
end; $$;
drop trigger if exists pact_approval_needed_email on public.pact_decisions;
create trigger pact_approval_needed_email after insert on public.pact_decisions
for each row execute function public.enqueue_approval_needed_email();

revoke all on function public.one_open_plan_decision(), public.enqueue_approval_needed_email() from public, anon, authenticated;
commit;
