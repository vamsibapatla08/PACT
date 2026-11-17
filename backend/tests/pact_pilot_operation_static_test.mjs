import assert from 'node:assert/strict'
import fs from 'node:fs'

const service = fs.readFileSync('frontend/src/lib/pactPilotService.ts', 'utf8')
const migration = fs.readFileSync('backend/supabase/migrations/20261117140000_pactpilot_action_engine.sql', 'utf8')

assert.match(service, /activeOperationIds\.has\(operationId\)/)
assert.match(service, /activeOperationIds\.add\(operationId\)/)
assert.match(service, /activeOperationIds\.delete\(operationId\)/)
assert.match(service, /begin_pact_ai_operation/)
assert.match(service, /finish_pact_ai_operation/)
assert.match(service, /context instanceof Response/)
assert.match(service, /payload\?\.error/)
assert.match(migration, /created_by = auth\.uid\(\) and status = 'awaiting_confirmation'/)
assert.match(migration, /status = 'executing'/)
assert.match(migration, /status = p_status/)

console.log('PACT Pilot operation static checks: PASS')
