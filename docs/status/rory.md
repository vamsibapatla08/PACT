# Rory — Agent and blockchain

- Status: In progress
- Done: 25/35
- Updated: 2026-11-16

## Main goal

- Friday Nov 13, 2–4 PM: get Google sign-in working for Pact with the team's real Google accounts, then prepare the Arc and Circle integration

## Checklist

### Set up Google OAuth (2:00–2:30 PM)

- [x] Open Google Cloud Console and create or select a project
- [x] Set up the Google OAuth consent screen and add the team's Google accounts as test users if needed
- [x] Create a Web Application OAuth client
- [x] Add the Supabase callback URL in Google Cloud
- [x] Turn on Google sign-in in Supabase with the Client ID and Client Secret

### Connect and test Google sign-in (2:30–3:00 PM)

- [x] Help Nihar connect the Google sign-in button to Supabase
- [x] Set the local and deployed redirect URLs
- [x] Test Google sign-in with at least two team members' Google accounts
- [x] Check users stay signed in after a refresh and can log out

### Work with Vamsi's backend (3:00–3:30 PM)

- [x] Check Google users show up in Supabase Auth
- [x] Help Vamsi check that profiles use the signed-in user's ID
- [x] Test that each user reaches their own dashboard
- [x] Check a signed-in user can create a pact

### Prepare Arc + Circle (3:30–4:00 PM)

- [x] Check Arc Testnet wallet support and the Circle integration options
- [x] Find the test USDC token and how the team gets test funds
- [x] Write up the payment flow for Vamsi and Dimple ([payment-flow.md](../payment-flow.md))
- [x] Push working changes to GitHub and report any blockers

### Wallets and payments (Nov 14)

- [x] Wallet table and `wallet` Edge Function: each user gets a Circle wallet on Arc Testnet
- [x] `transfer` and `pay_share` actions in the `wallet` function
- [x] PactSplit contract with tests: holds shares, releases, refunds, emits `SharePaid`
- [x] Deploy PactSplit to Arc Testnet and give Dimple the address
- [x] Add a `create_pact` action so the host opens the pact on chain
- [x] Run `backend/contracts/script/smoke.sh` on Arc and save the tx hashes
- [x] Pay one share with a real PIN through the app
- [ ] Send the first real USDC payment between two team wallets

### QuickNode (taken over from Dimple, Nov 16)

- [x] `quicknode-webhook` Edge Function: checks QuickNode's signature, decodes PactSplit events, marks shares paid and records Released, Cancelled and Refunded
- [ ] Point the Stream at PactSplit only (`0x6eadb2b3829e6d9c30208ff4122c40df7682d79d`), filtered on the SharePaid, Released, Refunded, Cancelled and PactCreated topics
- [ ] Deploy the webhook and set `QUICKNODE_SECURITY_TOKEN` on Supabase
- [ ] Pay one share in a small pact and check the SharePaid event reaches the webhook
- [ ] The same event sent twice changes nothing
- [ ] A wrong signature gets a 401
- [ ] Full loop: pay a share in the app and watch it show Paid without a refresh
- [ ] README section: setup steps, architecture picture, contract address, chain ID 5042002 and the stream filter
- [ ] Short screen clip of the stream firing for the demo video

## Blockers

- None. The app has buttons for every PactSplit action now, and the QuickNode webhook is written. What's left is deploying it and running the live tests

## Notes

- The Google Client Secret goes in Supabase only. Never in this repo
