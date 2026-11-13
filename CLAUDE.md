# Claude.md — PACT

Context for any AI agent working in this repo. Shared with the whole team.

## Layout

| Folder | What lives there |
|---|---|
| `frontend/` | The app people use. |
| `backend/` | Server and agent code. |
| `backend/supabase/` | The database as SQL. `migrations/` run in order, `seed.sql` is demo data for local only. |
| `docs/` | The team canvas, context files and notes about the project. |

[README.md](README.md) explains the app, the team and how to set up the database.

## Rules for agents

- Keep code in `frontend/` and `backend/`, and notes in `docs/`.
- Database changes go in a new file in `backend/supabase/migrations/`. Never edit a migration that has already been run.
- Every new table turns on row level security and gets policies in the same migration.
- Run Supabase CLI commands with `--workdir backend`.
- Never commit secrets or API keys. Put them in a `.env` file and keep it out of git.
- Keep changes small and say what changed in the commit message.
