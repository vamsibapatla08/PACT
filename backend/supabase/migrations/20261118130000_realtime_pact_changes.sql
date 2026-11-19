-- Live updates for everything a pact page shows, so the app refreshes when something actually changes instead of
-- re-asking the database every few seconds. Realtime checks each change against the table's read policies, so
-- people only hear about pacts they're in.
begin;

do $$
declare t text;
begin
  foreach t in array array[
    'pact_polls', 'pact_poll_votes', 'pact_items', 'pact_decisions', 'pact_decision_votes', 'pact_recommendations',
    'pact_payments', 'pact_shares', 'pact_members', 'pact_expenses', 'pact_settlements', 'pact_tab_paybacks',
    'pact_extras_rounds'
  ] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

commit;
