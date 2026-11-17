# PACT backend deployment package

Target project: `gnueyjkepcquehiigcis`

No deployment is performed by this package.

## 1. Backup checkpoint

In Supabase Dashboard, confirm a recent backup/PITR recovery point before the first write. If it cannot be confirmed, stop.

## 2. Preflight

Run `pactpilot_preflight.sql` in the SQL Editor. A missing-object result is informational; existing booking objects must be compared by exact function signature before any booking migration is reused.

## 3. SQL batches

Do not rerun manually installed booking migrations blindly. After preflight, execute only the missing files in this order:

1. `20261117190600_pact_rebalance.sql`
2. `20261117190700_pact_payment_obligations.sql`
3. `20261117190800_pactpilot_action_engine.sql`
4. `20261117190900_pactchat_action_cards.sql`
5. `20261117191000_pact_email_automation.sql`
6. `20261117191100_pact_action_card_sync.sql`

Each file is a self-contained transaction. Execute one file at a time and run `pactpilot_postflight.sql` after each successful batch. Do not continue after an error.

If any booking prerequisite is missing, stop and reconcile the six booking migrations first in their original order. Do not use `supabase db push` against this manually maintained project.

## 4. Edge Functions

After database verification:

```bash
supabase functions deploy booking --project-ref gnueyjkepcquehiigcis
supabase functions deploy pactpilot --project-ref gnueyjkepcquehiigcis
supabase functions deploy pact-email-worker --project-ref gnueyjkepcquehiigcis
```

Required server-side secrets:

```text
PACT_EMAIL_WORKER_TOKEN
RESEND_API_KEY
PACT_EMAIL_FROM
```

For a mock-only test, set `EMAIL_PROVIDER=mock`; do not provide real recipient addresses.

The email worker must be invoked by an authorized scheduler with `Authorization: Bearer <PACT_EMAIL_WORKER_TOKEN>`.

## 5. Smoke test

Use a disposable Pact and three test users. Test membership authorization, booking approval, equal split, obligation status, rebalance idempotency, action-card synchronization, and mock email retries. Do not use existing financial records.
