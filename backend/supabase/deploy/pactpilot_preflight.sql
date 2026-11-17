-- READ ONLY. Run first in Supabase SQL Editor.
select current_database(), current_user, version();

select to_regclass(x.name) as object_name
from (values
  ('public.pacts'), ('public.pact_members'), ('public.pact_payments'),
  ('public.pact_shares'), ('public.pact_payment_events'),
  ('public.pact_bookings'), ('public.pact_booking_proposals'),
  ('public.pact_booking_splits'), ('public.pact_booking_confirmations')
) as x(name)
where to_regclass(x.name) is null;

select proname, pg_get_function_identity_arguments(oid) as arguments,
       pg_get_function_result(oid) as result, prosecdef, proconfig
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'create_pact_booking_idempotent','create_pact_booking_proposal',
    'cast_pact_booking_approval','create_pact_booking_split',
    'cast_pact_booking_split_approval','associate_pact_booking_payment',
    'create_pact_rebalance_proposal','cast_pact_rebalance_vote',
    'apply_pact_rebalance_proposal','get_pact_payment_obligation_status',
    'create_pact_ai_operation','create_pact_action_card',
    'enqueue_pact_email','share_pact_action_card'
  )
order by proname, arguments;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname='public' and tablename like 'pact_%'
order by tablename, policyname;

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema='public'
  and grantee in ('anon','authenticated','service_role')
  and table_name like 'pact_%'
order by table_name, grantee, privilege_type;

select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname='public' and tablename like 'pact_%'
order by tablename, indexname;

select event_object_table, trigger_name, action_timing, event_manipulation
from information_schema.triggers
where event_object_schema='public' and event_object_table like 'pact_%'
order by event_object_table, trigger_name;
