begin;

-- The idempotent request RPC is the only client-facing booking-create path.
-- Keep the older function available for compatibility, but prevent direct
-- authenticated invocation from bypassing request-key protection.
revoke execute on function public.create_pact_booking(uuid, text, jsonb, integer, bigint, text)
from public, anon, authenticated;

commit;
