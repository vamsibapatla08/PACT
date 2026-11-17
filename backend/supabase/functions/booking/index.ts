import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const fixtures = [
  { id: 'demo-austin-lumen', title: 'Lumen House Austin', city: 'Austin', description: 'A quiet central stay with breakfast and flexible check-in.', nightly_cents: 11900, capacity: 3, amenities: ['Breakfast', 'Wi-Fi'] },
  { id: 'demo-austin-river', title: 'Riverline Suites', city: 'Austin', description: 'Spacious suites near the river district.', nightly_cents: 14900, capacity: 4, amenities: ['Kitchenette', 'Parking'] },
  { id: 'demo-austin-copper', title: 'Copper Row Hotel', city: 'Austin', description: 'A compact downtown hotel for short group stays.', nightly_cents: 8900, capacity: 2, amenities: ['Wi-Fi', 'Late checkout'] },
]

function admin() { return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!) }
async function userFrom(req: Request) {
  const authorization = req.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return null
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
  const { data: { user } } = await client.auth.getUser()
  return user ?? null
}
const nights = (checkIn: string, checkOut: string) => Math.ceil((Date.parse(checkOut) - Date.parse(checkIn)) / 86400000)

async function synchronizeBooking(pactId: string, bookingId: string, confirmationId: string, userId: string) {
  const event = await admin().from('pact_workflow_events').select('event_id,payload').eq('pact_id', pactId).eq('milestone_key', 'book').eq('event_type', 'demo_booking_confirmed')
  if (event.error) return { ok: false, error: event.error.message }
  const exists = (event.data ?? []).some((item) => item.payload && item.payload.booking_id === bookingId)
  if (!exists) {
    const inserted = await admin().from('pact_workflow_events').insert({ pact_id: pactId, milestone_key: 'book', event_type: 'demo_booking_confirmed', payload: { booking_id: bookingId, confirmation_id: confirmationId, simulated: true }, verified: true, created_by: userId })
    if (inserted.error) return { ok: false, error: inserted.error.message }
  }
  const milestone = await admin().from('pact_milestones').update({ status: 'complete', completed_at: new Date().toISOString() }).eq('pact_id', pactId).eq('milestone_key', 'book').eq('completion_source', 'verified_booking')
  if (milestone.error) return { ok: false, error: milestone.error.message }
  return { ok: true, error: null }
}

async function main(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { error: 'POST required' })
  const user = await userFrom(req)
  if (!user) return reply(401, { error: 'Authentication required' })
  const authorization = req.headers.get('Authorization')!
  const userDb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const action = body?.action
  if (action === 'search') {
    if (body?.category !== 'hotel') return reply(422, { error: 'Flights and events are not available in this demo yet.' })
    const city = typeof body.city === 'string' ? body.city.trim().toLowerCase() : ''
    const checkIn = typeof body.checkIn === 'string' ? body.checkIn : ''
    const checkOut = typeof body.checkOut === 'string' ? body.checkOut : ''
    const guestCount = Number(body.guestCount)
    const budgetCents = body.budgetCents == null ? null : Number(body.budgetCents)
    const stayNights = nights(checkIn, checkOut)
    if (!city || !Number.isInteger(guestCount) || guestCount < 1 || !Number.isInteger(stayNights) || stayNights < 1 || stayNights > 30 || (budgetCents !== null && (!Number.isInteger(budgetCents) || budgetCents <= 0))) return reply(400, { error: 'Enter a destination, valid dates, guest count, and optional positive budget.' })
    const options = fixtures.filter((item) => item.city.toLowerCase() === city && item.capacity >= guestCount).map((item) => { const subtotal = item.nightly_cents * stayNights; const taxes = Math.round(subtotal * .12); const fees = 1500; return { ...item, check_in: checkIn, check_out: checkOut, guest_count: guestCount, nights: stayNights, subtotal_cents: subtotal, taxes_cents: taxes, fees_cents: fees, total_cents: subtotal + taxes + fees, currency: 'USD', demo: true, quote_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() } }).filter((item) => budgetCents === null || item.total_cents <= budgetCents)
    return reply(200, { category: 'hotel', demo: true, options })
  }
  const pactId = body?.pactId
  if (typeof pactId !== 'string' || !UUID.test(pactId)) return reply(400, { error: 'Valid Pact ID required' })
  const db = admin()
  const { data: member } = await db.from('pact_members').select('user_id').eq('pact_id', pactId).eq('user_id', user.id).eq('membership_status', 'active').maybeSingle()
  if (!member) return reply(403, { error: 'Active Pact membership required' })
  if (action === 'create_request') {
    if (body?.category !== 'hotel') return reply(422, { error: 'Only hotel booking requests are enabled in this first slice.' })
    const { data, error } = await userDb.rpc('create_pact_booking_idempotent', { p_pact_id: pactId, p_category: body.category, p_requirements: body.requirements ?? {}, p_guest_count: Number(body.guestCount), p_budget_cents: body.budgetCents == null ? null : Number(body.budgetCents), p_currency: 'USD', p_request_key: body.requestKey })
    if (error) return reply(400, { error: error.message })
    return reply(200, { bookingId: data })
  }
  if (action === 'cancel') {
    const { data, error } = await userDb.rpc('cancel_pact_booking', { p_booking_id: body.bookingId })
    if (error) return reply(409, { error: error.message })
    return reply(200, { booking: data })
  }
  if (action === 'create_proposal') {
    const option = body.option
    if (!option || typeof option !== 'object' || typeof body.providerRef !== 'string') return reply(400, { error: 'A demo option is required' })
    const { data: booking } = await db.from('pact_bookings').select('booking_id').eq('booking_id', body.bookingId).eq('pact_id', pactId).maybeSingle()
    if (!booking) return reply(404, { error: 'Booking request not found' })
    const { data, error } = await userDb.rpc('create_pact_booking_proposal', { p_booking_id: body.bookingId, p_provider_ref: body.providerRef, p_option: option, p_total_cents: Number(body.totalCents), p_currency: 'USD', p_quote_expires_at: body.quoteExpiresAt, p_fingerprint: body.fingerprint })
    if (error) return reply(400, { error: error.message })
    return reply(200, { proposalId: data })
  }
  if (action === 'approve') {
    const { data, error } = await userDb.rpc('cast_pact_booking_approval', { p_proposal_id: body.proposalId, p_decision: body.decision })
    if (error) return reply(400, { error: error.message })
    return reply(200, { proposal: data })
  }
  if (action === 'create_split') {
    const splitType = body.splitType === 'custom' ? 'custom' : 'equal'
    const { data, error } = await userDb.rpc('create_pact_booking_split', { p_booking_id: body.bookingId, p_proposal_id: body.proposalId, p_split_type: splitType, p_custom_items: splitType === 'custom' ? body.items : null })
    if (error) return reply(400, { error: error.message })
    return reply(200, { splitId: data, splitType })
  }
  if (action === 'approve_split') {
    const { data, error } = await userDb.rpc('cast_pact_booking_split_approval', { p_split_id: body.splitId, p_decision: body.decision })
    if (error) return reply(400, { error: error.message })
    return reply(200, { split: data })
  }
  if (action === 'associate_payment') {
    if (!UUID.test(String(body.bookingId || '')) || !UUID.test(String(body.splitId || '')) || !UUID.test(String(body.paymentId || ''))) return reply(400, { error: 'Valid booking, split, and payment IDs are required' })
    const { data, error } = await userDb.rpc('associate_pact_booking_payment', { p_booking_id: body.bookingId, p_split_id: body.splitId, p_payment_id: body.paymentId })
    if (error) return reply(409, { error: error.message })
    return reply(200, { associationId: data })
  }
  if (action === 'finalize') {
    if (!UUID.test(String(body.bookingId || '')) || !UUID.test(String(body.proposalId || '')) || !UUID.test(String(body.splitId || '')) || !UUID.test(String(body.idempotencyKey || ''))) return reply(400, { error: 'Valid booking, proposal, split, and idempotency IDs are required' })
    const { data: host } = await db.from('pact_members').select('role').eq('pact_id', pactId).eq('user_id', user.id).eq('role', 'host').eq('membership_status', 'active').maybeSingle()
    if (!host) return reply(403, { error: 'Only the active Pact host can authorize the demo booking' })
    const { data: priorConfirmation } = await db.from('pact_booking_confirmations').select('*').eq('booking_id', body.bookingId).eq('status', 'confirmed').maybeSingle()
    if (priorConfirmation) return reply(200, { status: 'demo_confirmed', confirmation: priorConfirmation })
    const { data: booking } = await db.from('pact_bookings').select('*').eq('booking_id', body.bookingId).eq('pact_id', pactId).maybeSingle()
    const { data: proposal } = await db.from('pact_booking_proposals').select('*').eq('proposal_id', body.proposalId).eq('booking_id', body.bookingId).maybeSingle()
    const { data: split } = await db.from('pact_booking_splits').select('*').eq('split_id', body.splitId).eq('booking_id', body.bookingId).maybeSingle()
    if (!booking || !proposal || !split || split.status !== 'approved' || proposal.quote_expires_at <= new Date().toISOString()) return reply(409, { error: 'Booking approvals or quote are not valid for finalization' })
    const { data: required } = await db.from('pact_booking_required_members').select('user_id').eq('proposal_id', body.proposalId)
    const users = (required ?? []).map((item) => item.user_id)
    const { data: approvals } = await db.from('pact_booking_approvals').select('user_id,decision').eq('proposal_id', body.proposalId)
    const { data: splitApprovals } = await db.from('pact_booking_split_approvals').select('user_id,decision').eq('split_id', body.splitId)
    if (users.length === 0 || users.some((id) => !(approvals ?? []).some((vote) => vote.user_id === id && vote.decision === 'approve')) || users.some((id) => !(splitApprovals ?? []).some((vote) => vote.user_id === id && vote.decision === 'approve'))) return reply(409, { error: 'Every required member must approve the booking and split' })
    if (!UUID.test(String(body.paymentId || ''))) return reply(409, { error: 'Associate the approved split with its PactMoney funding plan first' })
    const association = await userDb.rpc('associate_pact_booking_payment', { p_booking_id: body.bookingId, p_split_id: body.splitId, p_payment_id: body.paymentId })
    if (association.error) return reply(409, { error: association.error.message })
    const { data: linked } = await db.from('pact_booking_payment_plans').select('payment_id,pact_id').eq('booking_id', body.bookingId).eq('split_id', body.splitId).maybeSingle()
    const { data: plan } = linked ? await db.from('pact_payments').select('payment_id,shares_needed,share_usdc,status').eq('payment_id', linked.payment_id).eq('pact_id', pactId).maybeSingle() : { data: null }
    if (!plan || plan.status !== 'open') return reply(409, { error: 'The associated PactMoney funding plan is unavailable' })
    const { data: shares } = await db.from('pact_shares').select('user_id,status,amount_usdc').eq('payment_id', plan.payment_id)
    const { data: splitItems } = await db.from('pact_booking_split_items').select('user_id,amount_cents').eq('split_id', body.splitId)
    const expectedShareCents = Math.round(Number(plan.share_usdc) * 100)
    if (split.split_type !== 'equal' || (splitItems ?? []).length !== users.length || (splitItems ?? []).some((item) => Number(item.amount_cents) !== expectedShareCents) || (shares ?? []).filter((item) => item.status === 'paid').length !== users.length || users.some((id) => !(shares ?? []).some((item) => item.user_id === id && item.status === 'paid' && Math.round(Number(item.amount_usdc) * 100) === expectedShareCents))) return reply(409, { error: 'Waiting for every required member contribution to be verified against the PactMoney share' })
    const { data: existing } = await db.from('pact_booking_attempts').select('attempt_id,attempt_status,provider_result').eq('booking_id', body.bookingId).eq('idempotency_key', body.idempotencyKey).maybeSingle()
    const { data: pendingAttempt } = await db.from('pact_booking_attempts').select('attempt_id').eq('booking_id', body.bookingId).eq('attempt_status', 'pending').maybeSingle()
    if (pendingAttempt && !existing) return reply(409, { error: 'A demo booking attempt is already pending. Retry with the same idempotency key.' })
    if (existing?.attempt_status === 'succeeded') {
      const { data: priorConfirmation } = await db.from('pact_booking_confirmations').select('*').eq('attempt_id', existing.attempt_id).maybeSingle()
      const sync = priorConfirmation ? await synchronizeBooking(pactId, body.bookingId, priorConfirmation.confirmation_id, user.id) : { ok: false, error: 'Confirmation record is missing' }
      return reply(200, { status: 'demo_confirmed', syncStatus: sync.ok ? 'synchronized' : 'pending_sync', syncError: sync.ok ? null : sync.error, attempt: existing, confirmation: priorConfirmation })
    }
    let attemptId = existing?.attempt_id
    if (!attemptId) { const inserted = await db.from('pact_booking_attempts').insert({ booking_id: body.bookingId, proposal_id: body.proposalId, idempotency_key: body.idempotencyKey, host_user_id: user.id, provider_request: { provider: 'demo', category: booking.category, option: proposal.option } }).select('attempt_id').single(); if (inserted.error) return reply(409, { error: inserted.error.message }); attemptId = inserted.data.attempt_id }
    const confirmationCode = `DEMO-HTL-${String(attemptId).replaceAll('-', '').slice(0, 6).toUpperCase()}`
    const details = { category: booking.category, option: proposal.option, total_cents: proposal.total_cents, currency: proposal.currency, confirmed_at: new Date().toISOString() }
    const confirmation = await db.from('pact_booking_confirmations').insert({ booking_id: body.bookingId, attempt_id: attemptId, provider_type: 'demo', demo_confirmation_code: confirmationCode, details, simulated: true, status: 'confirmed', confirmed_at: details.confirmed_at }).select('*').single()
    if (confirmation.error) return reply(409, { error: confirmation.error.message })
    const attemptUpdate = await db.from('pact_booking_attempts').update({ attempt_status: 'succeeded', provider_result: confirmation.data, updated_at: new Date().toISOString() }).eq('attempt_id', attemptId)
    const bookingUpdate = await db.from('pact_bookings').update({ status: 'demo_confirmed', updated_at: new Date().toISOString() }).eq('booking_id', body.bookingId)
    const sync = !attemptUpdate.error && !bookingUpdate.error ? await synchronizeBooking(pactId, body.bookingId, confirmation.data.confirmation_id, user.id) : { ok: false, error: attemptUpdate.error?.message || bookingUpdate.error?.message || 'Booking synchronization failed' }
    return reply(200, { status: 'demo_confirmed', syncStatus: sync.ok ? 'synchronized' : 'pending_sync', syncError: sync.ok ? null : sync.error, confirmation: confirmation.data })
  }
  if (action === 'reconcile') {
    const { data: host } = await db.from('pact_members').select('role').eq('pact_id', pactId).eq('user_id', user.id).eq('role', 'host').eq('membership_status', 'active').maybeSingle()
    if (!host) return reply(403, { error: 'Only the active Pact host can reconcile booking state' })
    if (!UUID.test(String(body.bookingId || ''))) return reply(400, { error: 'Valid booking ID required' })
    const { data: confirmation } = await db.from('pact_booking_confirmations').select('confirmation_id').eq('booking_id', body.bookingId).eq('status', 'confirmed').maybeSingle()
    if (!confirmation) return reply(404, { error: 'No confirmed booking exists to reconcile' })
    const sync = await synchronizeBooking(pactId, body.bookingId, confirmation.confirmation_id, user.id)
    if (!sync.ok) return reply(503, { error: sync.error || 'Booking synchronization is still pending' })
    return reply(200, { status: 'synchronized', confirmationId: confirmation.confirmation_id })
  }
  if (action === 'status') {
    const { data: booking, error } = await db.from('pact_bookings').select('*').eq('booking_id', body.bookingId).eq('pact_id', pactId).maybeSingle()
    if (error) return reply(500, { error: error.message })
    if (!booking) return reply(404, { error: 'Booking request not found' })
    const { data: proposals } = await db.from('pact_booking_proposals').select('*').eq('booking_id', body.bookingId).order('proposal_version', { ascending: false })
    const proposalIds = (proposals ?? []).map((item) => item.proposal_id)
    const { data: approvals } = proposalIds.length ? await db.from('pact_booking_approvals').select('*').in('proposal_id', proposalIds) : { data: [] }
    const { data: splits } = await db.from('pact_booking_splits').select('*').eq('booking_id', body.bookingId).order('split_version', { ascending: false })
    const splitIds = (splits ?? []).map((item) => item.split_id)
    const { data: splitItems } = splitIds.length ? await db.from('pact_booking_split_items').select('*').in('split_id', splitIds) : { data: [] }
    const { data: splitApprovals } = splitIds.length ? await db.from('pact_booking_split_approvals').select('*').in('split_id', splitIds) : { data: [] }
    const { data: confirmations } = await db.from('pact_booking_confirmations').select('*').eq('booking_id', body.bookingId).order('confirmed_at', { ascending: false })
    return reply(200, { booking, proposals: proposals ?? [], approvals: approvals ?? [], splits: splits ?? [], splitItems: splitItems ?? [], splitApprovals: splitApprovals ?? [], confirmations: confirmations ?? [], demo: true })
  }
  if (action === 'latest') {
    const { data: latest, error } = await db.from('pact_bookings').select('booking_id').eq('pact_id', pactId).order('updated_at', { ascending: false }).limit(1).maybeSingle()
    if (error) return reply(500, { error: error.message })
    if (!latest) return reply(200, { booking: null, proposals: [], approvals: [], splits: [], splitItems: [], splitApprovals: [], confirmations: [], demo: true })
    body.bookingId = latest.booking_id
    const { data: booking, error: bookingError } = await db.from('pact_bookings').select('*').eq('booking_id', latest.booking_id).maybeSingle()
    if (bookingError) return reply(500, { error: bookingError.message })
    const { data: proposals } = await db.from('pact_booking_proposals').select('*').eq('booking_id', latest.booking_id).order('proposal_version', { ascending: false })
    const ids = (proposals ?? []).map((item) => item.proposal_id)
    const { data: approvals } = ids.length ? await db.from('pact_booking_approvals').select('*').in('proposal_id', ids) : { data: [] }
    const { data: splits } = await db.from('pact_booking_splits').select('*').eq('booking_id', latest.booking_id).order('split_version', { ascending: false })
    const splitIds = (splits ?? []).map((item) => item.split_id)
    const { data: splitItems } = splitIds.length ? await db.from('pact_booking_split_items').select('*').in('split_id', splitIds) : { data: [] }
    const { data: splitApprovals } = splitIds.length ? await db.from('pact_booking_split_approvals').select('*').in('split_id', splitIds) : { data: [] }
    const { data: confirmations } = await db.from('pact_booking_confirmations').select('*').eq('booking_id', latest.booking_id)
    return reply(200, { booking, proposals: proposals ?? [], approvals: approvals ?? [], splits: splits ?? [], splitItems: splitItems ?? [], splitApprovals: splitApprovals ?? [], confirmations: confirmations ?? [], demo: true })
  }
  return reply(400, { error: 'Unsupported booking action' })
}

Deno.serve((req) => main(req).catch(() => reply(500, { error: 'Booking service unavailable' })))
