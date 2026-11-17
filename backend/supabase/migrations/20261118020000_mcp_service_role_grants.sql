-- The live project doesn't grant new tables to service_role on its own (local Supabase does), so the pact-mcp
-- function got "permission denied" on its own tables. Only the server-side key gets these; the browser still
-- only reads its own tokens, as set up in 20261117200000_mcp_tokens.sql.

grant select, insert, update on table public.pact_mcp_tokens to service_role;
grant select, insert, update, delete on table public.pact_mcp_oauth_clients to service_role;
grant select, insert, update, delete on table public.pact_mcp_oauth_requests to service_role;
