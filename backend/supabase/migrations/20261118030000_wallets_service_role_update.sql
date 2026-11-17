-- Moving to Base Sepolia replaces each person's Arc wallet row with their new Base one (an upsert on user_id).
-- service_role could only select and insert wallets (20261115004500), so the update was refused and
-- "Make my wallet" failed with "Wallet service is unavailable". Only the server-side key gets this.

grant update on table public.wallets to service_role;
