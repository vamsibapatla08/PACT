import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const ARC_CHAIN_ID = 5042002

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
  const pactId = body?.pactId
  const shareUsdc = body?.shareUsdc
  const deadline = body?.deadline
  const payeeAddress = body?.payeeAddress
  if (typeof pactId !== 'string' || !UUID.test(pactId)) return reply(400, { error: 'Invalid Pact ID' })
  if (typeof shareUsdc !== 'string' || !/^\d+(\.\d{1,6})?$/.test(shareUsdc) || Number(shareUsdc) <= 0) return reply(400, { error: 'Share amount must be a positive USDC amount with up to 6 decimals' })
  if (typeof deadline !== 'string' || Number.isNaN(Date.parse(deadline)) || Date.parse(deadline) <= Date.now()) return reply(400, { error: 'Deadline must be a future date' })
  if (typeof payeeAddress !== 'string' || !ADDRESS.test(payeeAddress)) return reply(400, { error: 'Invalid payee address' })

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

  const { data: existing, error: existingError } = await admin
    .from('pact_payments')
    .select('payment_id')
    .eq('pact_id', pactId)
    .maybeSingle()
  if (existingError) return reply(500, { error: 'Existing funding plans could not be checked' })
  if (existing) return reply(409, { error: 'This Pact already has a funding plan' })

  const { count, error: countError } = await admin
    .from('pact_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('pact_id', pactId)
    .eq('membership_status', 'active')
  if (countError || !count) return reply(409, { error: 'No active Pact members are available for this plan' })

  const { data: wallet, error: walletError } = await admin
    .from('wallets')
    .select('address')
    .eq('user_id', user.id)
    .maybeSingle()
  if (walletError) return reply(500, { error: 'Host wallet could not be checked' })
  if (!wallet) return reply(409, { error: 'Connect your Circle wallet before creating a funding plan' })

  const { data: paymentId, error: rpcError } = await admin.rpc('create_pact_payment_plan', {
    p_pact_id: pactId,
    p_host_user_id: user.id,
    p_payee_address: payeeAddress,
    p_share_usdc: shareUsdc,
    p_shares_needed: count,
    p_deadline: deadline,
    p_chain_id: ARC_CHAIN_ID,
    p_contract_address: pactSplitAddress,
  })
  if (rpcError) {
    if (rpcError.code === '23505') return reply(409, { error: 'This Pact already has a funding plan' })
    return reply(400, { error: rpcError.message })
  }
  return reply(200, { paymentId, sharesNeeded: count })
}

Deno.serve((req) => main(req).catch(() => reply(500, { error: 'Funding plan could not be created' })))
