# Rory — Agent and blockchain

- Status: Not started
- Done: 0/17
- Updated: 2026-11-13

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

- [ ] Check Arc Testnet wallet support and the Circle integration options
- [ ] Find the test USDC token and how the team gets test funds
- [ ] Write up the payment flow for Vamsi and Dimple
- [ ] Push working changes to GitHub and report any blockers

## Blockers

- None

## Notes

- The Google Client Secret goes in Supabase only. Never in this repo
