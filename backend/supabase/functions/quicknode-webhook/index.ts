// QuickNode Stream destination. Turns PactSplit events on Base Sepolia into Paid, Released, Cancelled and Refunded in Supabase.
// Only this function marks a share paid, and only after QuickNode's signature checks out.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { type PactEvent, pactEvents, validSignature } from './logs.ts'

const CHAIN_ID = 84532 // Base Sepolia
const TOKEN = Deno.env.get('QUICKNODE_SECURITY_TOKEN')
// QuickNode's connection check sends no signature headers, so the destination URL can carry ?key= instead.
const URL_KEY = Deno.env.get('QUICKNODE_URL_KEY')
const CONTRACT = Deno.env.get('PACT_SPLIT_ADDRESS')?.toLowerCase()

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

type Outcome = 'recorded' | 'skipped' | 'rejected'
type DbError = { code?: string; message: string } | null

// A raised exception (P0001) or a permission check (42501) means the event doesn't fit the plan, and retrying won't
// change that. Anything else is the database being unreachable, so QuickNode should try again.
class RetryableError extends Error {}
function settle(error: DbError): Outcome {
  if (!error) return 'recorded'
  if (error.code === 'P0001' || error.code === '42501') return 'rejected'
  throw new RetryableError(error.message)
}

async function userForWallet(address: string): Promise<string | null> {
  // ilike with no wildcards is a case-insensitive exact match, since Circle may save the address checksummed.
  const { data, error } = await admin.from('wallets').select('user_id').ilike('address', address).maybeSingle()
  if (error) throw new RetryableError(error.message)
  return data?.user_id ?? null
}

async function record(event: PactEvent): Promise<Outcome> {
  if (event.kind === 'created') return 'skipped' // pact_payments already holds the plan
  const { data: payment, error } = await admin.from('pact_payments').select('payment_id').eq('pact_id', event.pactId).maybeSingle()
  if (error) throw new RetryableError(error.message)
  if (!payment) return 'skipped' // a pact opened outside the app, like the smoke test

  const chain = { p_tx_hash: event.txHash, p_event_log_index: event.logIndex, p_block_number: event.blockNumber, p_chain_id: CHAIN_ID, p_contract_address: CONTRACT }

  if (event.kind === 'paid') {
    const userId = await userForWallet(event.address!)
    if (!userId) return 'rejected'
    const { error } = await admin.rpc('record_pact_share_payment', {
      p_payment_id: payment.payment_id, p_user_id: userId, p_wallet_address: event.address, p_amount_usdc: event.amountUsdc, ...chain,
    })
    return settle(error)
  }

  const userId = event.kind === 'refunded' ? await userForWallet(event.address!) : null
  if (event.kind === 'refunded' && !userId) return 'rejected'
  const { error: eventError } = await admin.rpc('record_pact_payment_event', {
    p_payment_id: payment.payment_id, p_event_type: event.kind, p_event_signature: event.signature, p_user_id: userId,
    p_amount_usdc: event.amountUsdc, ...chain,
  })
  return settle(eventError)
}

// Temporary: says why a delivery failed the signature check, without logging the token or the signature.
async function signatureHints(headers: Headers, body: string) {
  const encoder = new TextEncoder()
  const hmac = async (key: string, message: string) => {
    const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)))
  }
  const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  const nonce = headers.get('x-qn-nonce') ?? ''
  const timestamp = headers.get('x-qn-timestamp') ?? ''
  const given = (headers.get('x-qn-signature') ?? '').trim()
  const token = TOKEN ?? ''
  const matches: string[] = []
  for (const [keyName, key] of [['token', token], ['token trimmed', token.trim().replace(/^['"<]+|['">]+$/g, '')]]) {
    for (const [order, message] of [['nonce+timestamp+body', nonce + timestamp + body], ['timestamp+nonce+body', timestamp + nonce + body], ['body', body]]) {
      const mac = await hmac(key, message)
      if (hex(mac) === given.toLowerCase().replace(/^0x/, '')) matches.push(`${keyName}, ${order}, hex`)
      if (btoa(String.fromCharCode(...mac)) === given) matches.push(`${keyName}, ${order}, base64`)
    }
  }
  const tokenHash = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token)))).slice(0, 6)
  return {
    headers: [...headers.keys()],
    nonceLength: nonce.length, timestamp, signatureLength: given.length, bodyLength: body.length,
    tokenLength: token.length, tokenSha256Start: tokenHash, tokenHasExtraChars: token !== token.trim().replace(/^['"<]+|['">]+$/g, ''),
    matches,
  }
}

function sameSecret(given: string | null, expected: string | undefined) {
  if (!given || !expected || given.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 })
  if (!TOKEN || !CONTRACT) return Response.json({ error: 'Webhook is missing QUICKNODE_SECURITY_TOKEN or PACT_SPLIT_ADDRESS' }, { status: 503 })

  const body = await request.text()
  const nonce = request.headers.get('x-qn-nonce')
  const timestamp = request.headers.get('x-qn-timestamp')
  const signature = request.headers.get('x-qn-signature')
  const signed = Boolean(nonce && timestamp && signature) && await validSignature(TOKEN, nonce!, timestamp!, body, signature!)
  if (!signed && !sameSecret(new URL(request.url).searchParams.get('key'), URL_KEY)) {
    console.warn('Signature check failed', JSON.stringify(await signatureHints(request.headers, body)))
    return Response.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: unknown
  try { payload = JSON.parse(body) } catch { return Response.json({ error: 'Body is not JSON' }, { status: 400 }) }

  const counts: Record<Outcome, number> = { recorded: 0, skipped: 0, rejected: 0 }
  try {
    for (const event of pactEvents(payload, CONTRACT)) {
      const outcome = await record(event)
      counts[outcome] += 1
      if (outcome === 'rejected') console.warn('Rejected PactSplit event', event.kind, event.pactId, event.txHash, event.logIndex)
    }
  } catch (reason) {
    console.error('Webhook will be retried', reason instanceof Error ? reason.message : reason)
    return Response.json({ error: 'Could not save the events, retry', ...counts }, { status: 500 })
  }
  return Response.json(counts)
})
