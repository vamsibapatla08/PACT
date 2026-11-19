import { createClient } from 'npm:@supabase/supabase-js@2'
import { decodePact, PACTS_SELECTOR, pactKey } from '../wallet/chain.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const ARC_CHAIN_ID = 5042002
const ARC_RPC = 'https://rpc.testnet.arc.network'
const MAX_DEADLINE_MS = 90 * 24 * 60 * 60 * 1000

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

async function main(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { error: 'POST required' })

  const authorization = req.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return reply(401, { error: 'Authentication required' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const pactSplitAddress = Deno.env.get('PACT_SPLIT_ADDRESS')?.trim()
  if (!pactSplitAddress || !ADDRESS.test(pactSplitAddress)) return reply(503, { error: 'PactSplit is not configured for Arc Testnet' })
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
  })
  const { data: { user }, error: userError } = await userClient.auth.getUser()
  if (userError || !user) return reply(401, { error: 'Authentication required' })

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (body?.action === 'remove') return await removePlan(user.id, body?.pactId, pactSplitAddress)
  if (body?.action === 'remove_item') return await removeItem(user.id, body?.pactId, body?.itemId, pactSplitAddress)
  if (body?.action === 'set_item_scope') return await setItemScope(user.id, body?.pactId, body?.itemId, body?.scope, pactSplitAddress)
  const pactId = body?.pactId
  const shareUsdc = body?.shareUsdc
  const deadline = body?.deadline
  const payeeAddress = body?.payeeAddress
  if (typeof pactId !== 'string' || !UUID.test(pactId)) return reply(400, { error: 'Invalid Pact ID' })
  if (typeof shareUsdc !== 'string' || !/^\d+(\.\d{1,6})?$/.test(shareUsdc) || Number(shareUsdc) <= 0 || Number(shareUsdc) > 1_000_000) return reply(400, { error: 'Share amount must be a USDC amount above 0 and at most 1,000,000, with up to 6 decimals' })
  if (typeof deadline !== 'string' || Number.isNaN(Date.parse(deadline)) || Date.parse(deadline) <= Date.now()) return reply(400, { error: 'Deadline must be a future date' })
  if (Date.parse(deadline) > Date.now() + MAX_DEADLINE_MS) return reply(400, { error: 'Deadline must be in the next 90 days' })
  if (typeof payeeAddress !== 'string' || !ADDRESS.test(payeeAddress) || /^0x0{40}$/.test(payeeAddress)) return reply(400, { error: 'Invalid payee address' })

  const admin = adminClient()
  const { data: membership, error: membershipError } = await admin
    .from('pact_members')
    .select('role, membership_status')
    .eq('pact_id', pactId)
    .eq('user_id', user.id)
    .eq('role', 'host')
    .eq('membership_status', 'active')
    .maybeSingle()
  if (membershipError) return reply(500, { error: 'Pact membership could not be verified' })
  if (!membership) return reply(403, { error: 'Only an active Pact host can create a funding plan' })

  // A saved plan can be replaced until it is opened on chain; after that the contract holds its terms.
  const { data: existing, error: existingError } = await admin
    .from('pact_payments')
    .select('payment_id, round')
    .eq('pact_id', pactId)
    .maybeSingle()
  if (existingError) return reply(500, { error: 'Existing funding plans could not be checked' })
  if (existing) {
    const onChain = await pactOnChain(pactSplitAddress, pactId, existing.round ?? 0)
    if (onChain === null) return reply(502, { error: 'Arc could not be read, try again' })
    if (onChain) return reply(409, { error: 'This Pact is already open on chain, so its plan cannot change' })
  }

  const { data: wallet, error: walletError } = await admin
    .from('wallets')
    .select('address')
    .eq('user_id', user.id)
    .maybeSingle()
  if (walletError) return reply(500, { error: 'Host wallet could not be checked' })
  if (!wallet) return reply(409, { error: 'Connect your Circle wallet before creating a funding plan' })

  // shares_needed is counted inside the RPC: one share per active member with a wallet.
  const { data: rows, error: rpcError } = await admin.rpc('create_pact_payment_plan', {
    p_pact_id: pactId,
    p_host_user_id: user.id,
    p_payee_address: payeeAddress,
    p_share_usdc: shareUsdc,
    p_deadline: new Date(deadline).toISOString(),
    p_chain_id: ARC_CHAIN_ID,
    p_contract_address: pactSplitAddress,
    p_replace: Boolean(existing),
  })
  if (rpcError) {
    if (rpcError.code === '23505') return reply(409, { error: 'This Pact already has a funding plan' })
    return reply(400, { error: rpcError.message })
  }
  const plan = Array.isArray(rows) ? rows[0] : rows
  return reply(200, { paymentId: plan.payment_id, sharesNeeded: plan.shares_needed })
}

// "Change the plan": the coordinator takes back a saved split before collecting starts, so the plan can be fixed and
// approved again. Refused once it's on PactSplit, because then people may have paid in.
async function removePlan(userId: string, pactId: unknown, contract: string) {
  if (typeof pactId !== 'string' || !UUID.test(pactId)) return reply(400, { error: 'Invalid Pact ID' })
  const admin = adminClient()
  const { data: host } = await admin.from('pact_members').select('user_id').eq('pact_id', pactId).eq('user_id', userId)
    .eq('role', 'host').eq('membership_status', 'active').maybeSingle()
  if (!host) return reply(403, { error: 'Only the coordinator can change the plan' })
  const { data: plan } = await admin.from('pact_payments').select('payment_id, round').eq('pact_id', pactId).maybeSingle()
  if (!plan) return reply(200, { removed: false })
  const onChain = await pactOnChain(contract, pactId, plan.round ?? 0)
  if (onChain === null) return reply(502, { error: 'Arc could not be read, try again' })
  if (onChain) return reply(409, { error: 'Collecting has started, so the plan can only change by cancelling the collection' })
  await admin.from('pact_payment_obligations').delete().eq('payment_id', plan.payment_id)
  await admin.from('pact_shares').delete().eq('payment_id', plan.payment_id)
  const { error } = await admin.from('pact_payments').delete().eq('payment_id', plan.payment_id)
  if (error) return reply(500, { error: "Couldn't change the plan" })
  // The approved write-up no longer stands; the fixed plan goes up for approval again.
  await admin.from('pact_decisions').update({ status: 'rejected' }).eq('pact_id', pactId).eq('status', 'approved').not('recommendation_id', 'is', null)
  return reply(200, { removed: true })
}

// The pact on PactSplit for this round, or null if Arc could not be read.
async function readChainPact(contract: string, pactId: string, round: number) {
  try {
    const res = await fetch(ARC_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: contract, data: PACTS_SELECTOR + pactKey(pactId, round).slice(2) }, 'latest'] }),
    })
    return decodePact((await res.json()).result)
  } catch {
    return null
  }
}

// The coordinator takes an item off a plan that's already split. Everyone's share drops by its price.
//   Collecting not started: the saved share just drops.
//   Collecting started: the collection must change, so it's marked to cancel and reopen at the lower share. Anyone who
//   already paid takes their share back after the cancel and pays the new one, so nobody pays for what was removed.
//   Already paid out: refused, the money has gone to the coordinator.
async function removeItem(userId: string, pactId: unknown, itemId: unknown, contract: string) {
  if (typeof pactId !== 'string' || !UUID.test(pactId) || typeof itemId !== 'string' || !UUID.test(itemId)) return reply(400, { error: 'Invalid item' })
  const admin = adminClient()
  const { data: host } = await admin.from('pact_members').select('user_id').eq('pact_id', pactId).eq('user_id', userId)
    .eq('role', 'host').eq('membership_status', 'active').maybeSingle()
  if (!host) return reply(403, { error: 'Only the coordinator can remove items from the plan' })
  const { data: item } = await admin.from('pact_items').select('item_id, title, price_each, price_scope').eq('pact_id', pactId).eq('item_id', itemId).maybeSingle()
  if (!item) return reply(404, { error: 'That item is already gone' })
  const { count: people } = await admin.from('pact_members').select('user_id', { count: 'exact', head: true }).eq('pact_id', pactId).eq('membership_status', 'active')
  const price = item.price_scope === 'group' ? Math.ceil((Number(item.price_each ?? 0) * 100) / Math.max(1, people ?? 1)) / 100 : Number(item.price_each ?? 0)
  const { data: plan } = await admin.from('pact_payments').select('payment_id, round, share_usdc, shares_needed, status').eq('pact_id', pactId).maybeSingle()

  if (!plan) {
    await admin.from('pact_items').delete().eq('item_id', itemId)
    return reply(200, { removed: true, newShare: null, reopen: false, paid: 0 })
  }
  const newShare = Math.round((Number(plan.share_usdc) - price) * 100) / 100
  if (!(newShare > 0)) return reply(409, { error: "That's everything in the split. Use Change the plan to start again instead." })
  const chainPact = await readChainPact(contract, pactId, plan.round ?? 0)
  if (!chainPact) return reply(502, { error: 'Arc could not be read, try again' })
  if (chainPact.state === 'released') return reply(409, { error: "This was already paid out, so send people their part back with Send money." })

  await admin.from('pact_items').delete().eq('item_id', itemId)
  if (chainPact.state === 'none') {
    await admin.from('pact_payments').update({ share_usdc: newShare, updated_at: new Date().toISOString() }).eq('payment_id', plan.payment_id)
    return reply(200, { removed: true, newShare, reopen: false, paid: 0 })
  }
  // Open or cancelled on chain: share the new, lower total again when it reopens.
  await admin.from('pact_payments').update({
    needs_reopen: true, reopen_total: newShare * Number(plan.shares_needed), updated_at: new Date().toISOString(),
  }).eq('payment_id', plan.payment_id)
  return reply(200, { removed: true, newShare, reopen: true, paid: chainPact.state === 'open' ? chainPact.sharesPaid : 0 })
}

// The coordinator says whether an item's price is per person ('each') or once for the whole group ('group'). With a
// split saved, everyone's share moves by the difference; if collecting started, it cancels and reopens as for removing.
async function setItemScope(userId: string, pactId: unknown, itemId: unknown, scope: unknown, contract: string) {
  if (typeof pactId !== 'string' || !UUID.test(pactId) || typeof itemId !== 'string' || !UUID.test(itemId) || (scope !== 'each' && scope !== 'group')) return reply(400, { error: 'Invalid item' })
  const admin = adminClient()
  const { data: host } = await admin.from('pact_members').select('user_id').eq('pact_id', pactId).eq('user_id', userId)
    .eq('role', 'host').eq('membership_status', 'active').maybeSingle()
  if (!host) return reply(403, { error: 'Only the coordinator can change how an item is priced' })
  const { data: item } = await admin.from('pact_items').select('item_id, price_each, price_scope').eq('pact_id', pactId).eq('item_id', itemId).maybeSingle()
  if (!item) return reply(404, { error: 'That item is gone' })
  if (item.price_scope === scope) return reply(200, { changed: false })
  const { count: people } = await admin.from('pact_members').select('user_id', { count: 'exact', head: true }).eq('pact_id', pactId).eq('membership_status', 'active')
  const n = Math.max(1, people ?? 1)
  const price = Number(item.price_each ?? 0)
  const perPerson = (s: string) => (s === 'group' ? Math.ceil((price * 100) / n) / 100 : price)
  const delta = perPerson(scope) - perPerson(item.price_scope ?? 'each')
  const { data: plan } = await admin.from('pact_payments').select('payment_id, round, share_usdc, shares_needed').eq('pact_id', pactId).maybeSingle()
  if (plan) {
    const newShare = Math.round((Number(plan.share_usdc) + delta) * 100) / 100
    if (!(newShare > 0)) return reply(409, { error: "That would make everyone's share zero" })
    const chainPact = await readChainPact(contract, pactId, plan.round ?? 0)
    if (!chainPact) return reply(502, { error: 'Arc could not be read, try again' })
    if (chainPact.state === 'released') return reply(409, { error: 'This was already paid out' })
    if (chainPact.state === 'none') {
      await admin.from('pact_payments').update({ share_usdc: newShare, updated_at: new Date().toISOString() }).eq('payment_id', plan.payment_id)
    } else {
      await admin.from('pact_payments').update({ needs_reopen: true, reopen_total: newShare * Number(plan.shares_needed), updated_at: new Date().toISOString() }).eq('payment_id', plan.payment_id)
    }
  }
  const { error } = await admin.from('pact_items').update({ price_scope: scope }).eq('item_id', itemId)
  if (error) return reply(500, { error: "Couldn't change it" })
  return reply(200, { changed: true })
}

// Whether PactSplit already holds this pact (any state but None). Null if Arc could not be read.
async function pactOnChain(contract: string, pactId: string, round: number): Promise<boolean | null> {
  try {
    const res = await fetch(ARC_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: contract, data: PACTS_SELECTOR + pactKey(pactId, round).slice(2) }, 'latest'] }),
    })
    const pact = decodePact((await res.json()).result)
    return pact ? pact.state !== 'none' : null
  } catch {
    return null
  }
}

Deno.serve((req) => main(req).catch(() => reply(500, { error: 'Funding plan could not be created' })))
