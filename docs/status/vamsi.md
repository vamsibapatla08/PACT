# Vamsi — Backend (Supabase)

- Status: Not started
- Done: 0/6
- Updated: 2026-11-13

## Main goal

- The Supabase database is ready for sign-in and for creating pacts

## Checklist

### Backend preparation

- [ ] Check the Supabase project is connected to the frontend and backend
- [ ] Create the `profiles` table for user IDs, names, emails and profile pictures
- [ ] Create the `pacts` table for pact names, creators, budgets and status
- [ ] Create the `pact_members` table to link users to their pacts and roles
- [ ] Turn on Row Level Security and add policies so users can't see pacts they aren't in
- [ ] Make sure the frontend team has the Supabase project URL and publishable key

## Blockers

- None

## Notes

- A first version of all three tables is in `backend/supabase/migrations/20261113000000_core.sql`
- Never share the secret service-role key
