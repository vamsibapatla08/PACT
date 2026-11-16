# Rory — Agent and blockchain

- Status: In progress
- Done: 9/25
- Updated: 2026-11-15

## Main goal

- Friday Nov 13, 2–4 PM: get Google sign-in working for Pact with the team's real Google accounts, then prepare the Arc and Circle integration

## Checklist

### Set up Google OAuth (2:00–2:30 PM)

- [ ] Open Google Cloud Console and create or select a project
- [ ] Set up the Google OAuth consent screen and add the team's Google accounts as test users if needed
- [ ] Create a Web Application OAuth client
- [ ] Add the Supabase callback URL in Google Cloud
- [ ] Turn on Google sign-in in Supabase with the Client ID and Client Secret

### Connect and test Google sign-in (2:30–3:00 PM)

- [ ] Help Nihar connect the Google sign-in button to Supabase
- [ ] Set the local and deployed redirect URLs
- [ ] Test Google sign-in with at least two team members' Google accounts
- [ ] Check users stay signed in after a refresh and can log out

### Work with Vamsi's backend (3:00–3:30 PM)

- [ ] Check Google users show up in Supabase Auth
- [ ] Help Vamsi check that profiles use the signed-in user's ID
- [ ] Test that each user reaches their own dashboard
- [ ] Check a signed-in user can create a pact

### Prepare Arc + Circle (3:30–4:00 PM)

- [x] Check Arc Testnet wallet support and the Circle integration options
- [x] Find the test USDC token and how the team gets test funds
- [x] Write up the payment flow for Vamsi and Dimple ([payment-flow.md](../payment-flow.md))
- [ ] Push working changes to GitHub and report any blockers

### Wallets and payments (Nov 14)

- [x] Wallet table and `wallet` Edge Function: each user gets a Circle wallet on Arc Testnet
- [x] `transfer` and `pay_share` actions in the `wallet` function
- [x] PactSplit contract with tests: holds shares, releases, refunds, emits `SharePaid`
- [x] Deploy PactSplit to Arc Testnet and give Dimple the address
- [x] Add a `create_pact` action so the host opens the pact on chain
- [x] Run `backend/contracts/script/smoke.sh` on Arc and save the tx hashes
- [ ] Pay one share with a real PIN through the app
- [ ] Send the first real USDC payment between two team wallets

## Blockers

- None. The app has buttons for every PactSplit action now. What's left is running the live tests

## Notes

- The Google Client Secret goes in Supabase only. Never in this repo
