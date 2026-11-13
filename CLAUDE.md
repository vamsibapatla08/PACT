# Context — PACT

Context for any AI agent working in this repo, and the team-only notes. Shared with the whole team.
[README.md](README.md) is the public page: what Pact is, how it works and who built it.

## Layout

| Folder | What lives there |
|---|---|
| `frontend/` | The app people use. |
| `backend/` | Server and agent code. |
| `backend/supabase/` | The database as SQL. `migrations/` run in order, `seed.sql` is demo data for local only. |
| `docs/` | The team canvas, context files and notes about the project. |
| `docs/status/` | One checklist per person and the group checklist. |

## Who owns what

| Person | Area | Status file |
|---|---|---|
| Rory | Agent, Google OAuth, Arc and Circle | `docs/status/rory.md` |
| Nihar | Frontend | `docs/status/nihar.md` |
| Vamsi | Backend (Supabase) | `docs/status/vamsi.md` |
| Dimple | QuickNode endpoint and Streams | `docs/status/dimple.md` |

## Status checklists

- When you finish a task, tick it in your own file (`- [ ]` to `- [x]`), then fix the `Status`, `Done` and `Updated` lines at the top
- Copy your Status and Done into your row of the table in `docs/status/README.md`
- Add blockers under `## Blockers` in your file and in the README, with your name
- Tick a group checklist item only when everyone named on it has ticked their part
- Agents: only edit the status file of the person you are working for. Never tick someone else's task

## Database

### Tables so far

- `profiles`: one per user, made automatically when they sign in with Google
- `pacts`: a group planning something, with an invite code
- `pact_members`: who is in each pact. The person who creates a pact is its host
- Chat, plans, votes and payments come next

### Who can see what

- A user only sees pacts they are in, and the people in them
- Only the host can edit the pact or let someone handle money
- Join a pact with `supabase.rpc('join_pact', { p_invite_code: 'abc12345' })`

### Add the SQL to Supabase

Option 1, in the dashboard:

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

- Add a new file: `supabase migration new <what_it_does> --workdir backend`
- Write the SQL, test it locally, then push

## Keys

- The frontend gets the Supabase project URL and publishable key only
- The service-role key, the Google Client Secret, Circle keys and the QuickNode endpoint stay in each person's own `.env` or in the service's dashboard
- Never paste a key into a status file, the canvas, a commit or the group chat

## Working on the repo

- Pull before you start: `git pull`
- Work on your own branch, then open a pull request
- Keep commits small and say what changed, e.g. `status: rory ticked OAuth setup`

## Rules for agents

- Keep code in `frontend/` and `backend/`, and notes in `docs/`.
- Database changes go in a new file in `backend/supabase/migrations/`. Never edit a migration that has already been run.
- Every new table turns on row level security and gets policies in the same migration.
- Run Supabase CLI commands with `--workdir backend`.
- Never commit secrets or API keys. Put them in a `.env` file and keep it out of git.
- Keep changes small and say what changed in the commit message.
