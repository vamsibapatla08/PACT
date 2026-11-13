# PACT

Plan a trip with friends in one group chat, agree on it, and pay your share, with every payment checked on chain.

## The problem

- Group trips fall apart in the group chat. Nobody agrees on dates, budget or place
- One person ends up booking and paying for everyone, then chasing people for weeks to get paid back
- "I sent it" is hard to check, and nobody likes asking twice

## What Pact does

- One chat per plan, with an AI agent in it that sums up what the group agreed and finds real options
- Everyone votes. Nothing is bought until the group agrees
- Each person pays their own share, and only up to the spend cap they set
- A share only shows "Paid" once the payment is checked on the blockchain
- No one sees crypto. Everyone sees dollars

## How it works

1. Sign in with Google
2. Create a pact, or join one with an invite link
3. Chat about dates, budget, place and how many people are coming
4. Everyone taps Agree
5. The agent checks the plan and suggests changes
6. The agent shows 2 to 3 options, and the group votes
7. Each person taps "Pay my share", or one person pays and the rest pay them back
8. Watch "3 of 4 paid" fill up while the booking is held for 10 minutes
9. Booked. Everyone gets a receipt they can check for themselves

## Our promises

- Nothing shows "Paid" until it is checked on chain
- Nothing is bought without a group vote
- No one pays more than their spend cap
- The AI agent can suggest and organise, but it never touches money
- Test money only during the hackathon. No real funds

## Built with

| Part | What we use |
|---|---|
| App | Web app, hosted on Vercel |
| Accounts, data and chat | Supabase (Google sign-in, Postgres, realtime) |
| AI agent | Grok, which can only use the tools on our own MCP server |
| Wallets and payments | Circle wallets and test USDC on the Arc test network |
| Payment checks | QuickNode Streams watches our contract and tells our server |

## Privacy

- You only see the pacts you are in, and the people in them
- Only the host of a pact can change it
- Every table in the database has row level security turned on

## Team

| Name | Role |
|---|---|
| Rory Geddes | AI agent and blockchain |
| Nihar | Frontend |
| Vamsi | Backend (Supabase) |
| Dimple | Onchain data (QuickNode) |

## Hackathon

- Built for UBC 2026, hacking Nov 13 to 20
- Submission due Fri Nov 20, 12 PM CST. Finals Nov 21 in Austin
- Tracks: Consumer Applications, and Best Use of Circle's Arc

## Progress

- See where we are at in [docs/status/](docs/status/README.md): one checklist per person and one for the whole team

## Repo

| Folder | What lives there |
|---|---|
| `frontend/` | The app people use |
| `backend/` | Server and agent code |
| `backend/supabase/` | The database as SQL migrations |
| `docs/` | Our planning canvas, notes and status checklists |
