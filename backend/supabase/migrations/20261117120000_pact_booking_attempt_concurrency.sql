begin;

-- The application performs a friendly pending-attempt check, but this index is
-- the authoritative protection against two different finalization requests
-- racing at the same time.
create unique index if not exists pact_booking_one_pending_attempt_idx
on public.pact_booking_attempts (booking_id)
where attempt_status = 'pending';

commit;
