-- READ ONLY. Run after each approved batch.
select to_regclass(x.name) as missing_object
from (values
  ('public.pact_rebalance_proposals'), ('public.pact_rebalance_votes'),
  ('public.pact_rebalance_audit'), ('public.pact_payment_obligations'),
  ('public.pact_ai_operations'), ('public.pact_action_cards'),
  ('public.pact_ai_audit_events'), ('public.pact_email_outbox')
) as x(name)
where to_regclass(x.name) is null;

select proname, pg_get_function_identity_arguments(oid) as arguments,
       prosecdef, proconfig
from pg_proc
where pronamespace='public'::regnamespace
  and proname in (
    'create_pact_rebalance_proposal','cast_pact_rebalance_vote',
    'apply_pact_rebalance_proposal','get_pact_payment_obligation_status',
    'create_pact_ai_operation','create_pact_action_card',
    'enqueue_pact_email','begin_pact_ai_operation',
    'finish_pact_ai_operation','share_pact_action_card'
  )
order by proname, arguments;

select tablename, policyname, cmd
from pg_policies
where schemaname='public'
  and tablename in (
    'pact_rebalance_proposals','pact_rebalance_votes',
    'pact_rebalance_audit','pact_payment_obligations',
    'pact_ai_operations','pact_action_cards','pact_email_outbox'
  )
order by tablename, policyname;

select event_object_table, trigger_name
from information_schema.triggers
where event_object_schema='public'
  and event_object_table in (
    'pact_booking_confirmations','pact_shares','pact_decisions',
    'pact_bookings','pact_booking_splits','pact_rebalance_proposals',
    'pact_payments'
  )
order by event_object_table, trigger_name;
