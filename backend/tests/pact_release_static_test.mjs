import assert from 'node:assert/strict'
import fs from 'node:fs'

const root = new URL('..', import.meta.url).pathname
const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8')
const rebalance = read('../supabase/migrations/20261117190700_pact_payment_obligations.sql')
const action = read('../supabase/migrations/20261117190800_pactpilot_action_engine.sql')
const worker = read('../supabase/functions/pact-email-worker/index.ts')
const tools = read('../supabase/functions/pactpilot/tools.ts')

assert.match(rebalance, /create table if not exists public\.pact_payment_obligations/)
assert.match(rebalance, /status in \('paid','refunded'\)/)
assert.match(rebalance, /status','applied'/)
assert.match(rebalance, /Unanimous active-member approval is required/)
assert.match(action, /Poll card must contain a valid decision ID/)
assert.match(action, /Booking receipt does not belong to a confirmed booking/)
assert.match(action, /Payment receipt requires a verified paid share/)
assert.match(worker, /PACT_EMAIL_WORKER_TOKEN/)
assert.match(worker, /return json\(\{ error: "Unauthorized" \}, 401\)/)
assert.match(tools, /apply_rebalance/)
console.log('PACT release static checks: PASS')
