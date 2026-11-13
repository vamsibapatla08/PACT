# PACT

Plan a trip with friends in a group chat, agree on it, and pay your share, with every payment checked on chain.

## What it is

- A group chat app for planning things together, like a trip
- An AI agent (Grok) sits in the chat, sums up what the group agreed and finds options
- Everyone votes, then each person pays their share
- A share only shows "Paid" once the payment is checked on the blockchain
- Users never see crypto. They see dollars

## Hackathon

- UBC 2026, hacking Nov 13 to 20
- Due Fri Nov 20, 12 PM CST. Finals Nov 21 in Austin
- Tracks: Consumer Applications, and Best Use of Circle's Arc

## How it works for a user

1. Sign in with Google
2. Create a pact, or join one with an invite link
3. Chat about dates, budget, place and how many people
4. Everyone taps Agree
5. The agent checks the plan and suggests changes
6. The agent shows 2 to 3 options. The group votes
7. Each person taps "Pay my share" (or one person pays and the rest pay them back)
8. Watch "3 of 4 paid". The booking is held for 10 minutes
9. Booked. Everyone gets a receipt they can check

## Rules the system follows

- Nothing shows "Paid" until it is checked on chain
- Nothing is bought without a group vote
- No one pays more than their spend cap
- Test money only. No real money during the hackathon

## Tech

- **Frontend:** web app on Vercel
- **Backend:** Supabase (database, Google sign-in, realtime chat)
- **Agent:** Grok, which only calls tools on our MCP server and never touches money
- **Wallets and payments:** Circle wallets and test USDC on the Arc test network
- **Payment checks:** QuickNode watches our contract and tells our webhook

## Team

- **Rory:** agent and blockchain
- **Nihar:** frontend
- **Vamsi:** backend (Supabase)
- **Dimple:** onchain data (QuickNode)

Where everyone is at: [docs/status/](docs/status/README.md). Each person has their own checklist there, plus one group checklist.

## Folders

- `frontend/`: the app people use
- `backend/`: server code
- `backend/supabase/`: the database, saved as SQL files
- `docs/`: the team canvas and notes
- `docs/status/`: each person's checklist and the group checklist

## Database (Supabase)

### What is in it so far

- `profiles`: one per user, made automatically when they sign in with Google
- `pacts`: a group planning something, with an invite code
- `pact_members`: who is in each pact. The person who creates a pact is its host
- Chat, plans, votes and payments come next

### Who can see what

- You only see pacts you are in, and the people in them
- Only the host can edit the pact or let someone handle money
- Join a pact with `supabase.rpc('join_pact', { p_invite_code: 'abc12345' })`

### Add the SQL to Supabase

Option 1, the easy way:

- Open the Supabase dashboard, then SQL Editor
- Paste each file from `backend/supabase/migrations/` in order, oldest first, and run it

Option 2, with the Supabase CLI:

- `supabase link --project-ref <your-project-ref> --workdir backend`
- `supabase db push --workdir backend`

### Run it on your own computer

- Needs Docker and the Supabase CLI
- `supabase start --workdir backend` starts a local Supabase
- `supabase db reset --workdir backend` rebuilds it and loads the demo data in `seed.sql`

### Change the database

- Never edit an old migration file that has already been run
- Add a new file: `supabase migration new <what_it_does> --workdir backend`
- Write the SQL, test it locally, then push

## Working on the repo

- Pull before you start: `git pull`
- Keep commits small and say what changed
- Never commit keys or passwords. Put them in a `.env` file, which git ignores
