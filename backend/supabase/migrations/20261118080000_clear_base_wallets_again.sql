-- 20261118040000_back_to_arc.sql cleared the Base Sepolia wallet rows, but the wallet function on live was still the
-- Base version for a while, and it saved some Base wallets again when people opened the app. Clear them once more,
-- now that the Arc wallet function is deployed. Opening the app then finds each person's Arc wallet in Circle and
-- saves it back, with its real address, balance and activity.
delete from public.wallets where blockchain = 'BASE-SEPOLIA';
