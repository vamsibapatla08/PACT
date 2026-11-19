-- The live project doesn't grant new tables to service_role on its own (see 20261118020000_mcp_service_role_grants),
-- so the server functions couldn't read or change plan items. These are exactly what they need:
--   create-pact-payment-plan: remove an item, price it for the group, or take back a saved split.
--   pact-email-worker: the pact's name, its items and the plan, for the email text.
-- service_role is only ever used by the server functions; the app never has this key.
begin;

grant select, update, delete on table public.pact_items to service_role;
grant select, update, delete on table public.pact_payments to service_role;
grant select, delete on table public.pact_shares to service_role;
grant select, delete on table public.pact_payment_obligations to service_role;
grant select, update on table public.pact_decisions to service_role;
grant select on table public.pacts, public.pact_recommendations, public.pact_members to service_role;

commit;
