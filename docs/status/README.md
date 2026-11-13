# Team status

Where everyone is at. Each person has their own checklist, and the group checklist below holds what we only finish together.

## Everyone

| Person | Role | Status | Done | File |
|---|---|---|---|---|
| Rory | Agent and blockchain | Not started | 0/17 | [rory.md](rory.md) |
| Nihar | Frontend | Not started | 0/9 | [nihar.md](nihar.md) |
| Vamsi | Backend (Supabase) | Not started | 0/6 | [vamsi.md](vamsi.md) |
| Dimple | Onchain data (QuickNode) | Not started | 0/5 | [dimple.md](dimple.md) |

Status is one of: Not started, In progress, Blocked, Done.

## Group checklist

Day 1, Friday Nov 13. Tick one only when the whole team has seen it work.

- [ ] Frontend has the login page, dashboard and Create Pact form (Nihar)
- [ ] Database has profiles, pacts and pact_members with RLS on (Vamsi)
- [ ] Google sign-in works for at least two team members (Rory, Nihar)
- [ ] A signed-in user lands on their own dashboard (Rory, Nihar, Vamsi)
- [ ] A signed-in user can create a pact and see it saved (Nihar, Vamsi)
- [ ] Arc Testnet endpoint and Streams access are ready (Dimple)
- [ ] Payment flow on Arc + Circle is written up for the team (Rory)
- [ ] Everyone has pushed their work to their own branch

## Blockers

- None yet

## How to update

- Open your own file, change `[ ]` to `[x]` when a task is done, and add new tasks as you find them
- Change the Status line at the top of your file, and the row for you in the table above
- Put anything stopping you under Blockers, with your name
- Never put API keys, secrets or the Supabase service-role key in these files
- Pull before you edit, keep the commit small: `git commit -m "status: rory ticked OAuth setup"`

## Add a new person

- Copy [_template.md](_template.md) to `<name>.md`
- Add a row for them in the table above
