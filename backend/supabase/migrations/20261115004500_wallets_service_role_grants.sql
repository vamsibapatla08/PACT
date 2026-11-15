begin;

-- The wallet Edge Function reads and saves wallets with the service role.
-- The live project's default privileges give service_role no select or insert on new tables,
-- and bypassing RLS does not bypass grants, so grant exactly what the function uses.
grant select, insert on table public.wallets to service_role;

commit;
