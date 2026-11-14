// Returns the signed-in user's Circle wallet on Arc Testnet, making it the first time.
// POST /functions/v1/wallet with the user's Supabase session token.
// Calls Circle's REST API directly: its Node SDK fails to boot in the Edge runtime.
import { createClient } from 'npm:@supabase/supabase-js@2'

const BLOCKCHAIN = 'ARC-TESTNET'
const ARC_RPC = 'https://rpc.testnet.arc.network'
const CIRCLE_API = 'https://api.circle.com/v1/w3s'
const CIRCLE_API_KEY = Deno.env.get('CIRCLE_API_KEY')!
const CIRCLE_ENTITY_SECRET = Deno.env.get('CIRCLE_ENTITY_SECRET')!
const CIRCLE_WALLET_SET_ID = Deno.env.get('CIRCLE_WALLET_SET_ID')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

type CircleWallet = { id: string; address: string; blockchain: string }

async function circleRequest(path: string, init: RequestInit = {}) {
  const res = await fetch(`${CIRCLE_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${CIRCLE_API_KEY}`, 'Content-Type': 'application/json' },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Circle ${path} ${res.status}: ${body.message ?? ''}`)
  return body.data
}

// Circle wants the entity secret RSA-encrypted with its public key, freshly for every write.
async function entitySecretCiphertext() {
  const { publicKey } = await circleRequest('/config/entity/publicKey')
  const der = Uint8Array.from(atob(publicKey.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('spki', der, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])
  const secret = Uint8Array.from(CIRCLE_ENTITY_SECRET.match(/../g)!, (h) => parseInt(h, 16))
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, secret))
  return btoa(String.fromCharCode(...encrypted))
}

async function createCircleWallet(userId: string): Promise<CircleWallet | undefined> {
  const data = await circleRequest('/developer/wallets', {
    method: 'POST',
    body: JSON.stringify({
      idempotencyKey: userId,
      entitySecretCiphertext: await entitySecretCiphertext(),
      walletSetId: CIRCLE_WALLET_SET_ID,
      blockchains: [BLOCKCHAIN],
      count: 1,
      accountType: 'EOA',
      metadata: [{ refId: userId }],
    }),
  })
  return data?.wallets?.[0]
}

async function findCircleWallet(userId: string): Promise<CircleWallet | undefined> {
  const params = new URLSearchParams({ walletSetId: CIRCLE_WALLET_SET_ID, refId: userId, blockchain: BLOCKCHAIN })
  const data = await circleRequest(`/wallets?${params}`)
  return data?.wallets?.[0]
}

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

// USDC is Arc's native token, so the native balance is the USDC balance (18 decimals).
async function usdcBalance(address: string): Promise<string | null> {
  try {
    const res = await fetch(ARC_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }),
    })
    const { result } = await res.json()
    const wei = BigInt(result)
    const whole = wei / 10n ** 18n
    const cents = (wei % 10n ** 18n) / 10n ** 16n
    return `${whole}.${cents.toString().padStart(2, '0')}`
  } catch {
    return null
  }
}

async function walletResponse(row: { address: string; blockchain: string }, created: boolean) {
  return reply(200, {
    address: row.address,
    blockchain: row.blockchain,
    usdc_balance: await usdcBalance(row.address),
    created,
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'GET' && req.method !== 'POST') return reply(405, { error: 'Use GET or POST' })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  const { data: { user } } = token ? await admin.auth.getUser(token) : { data: { user: null } }
  if (!user) return reply(401, { error: 'Sign in first' })

  const { data: existing, error: readError } = await admin
    .from('wallets').select('address, blockchain').eq('user_id', user.id).maybeSingle()
  if (readError) return reply(500, { error: 'Could not read wallet' })
  if (existing) return walletResponse(existing, false)

  // The user's ID doubles as Circle's idempotency key, so two calls at once
  // still make only one wallet. The losing call finds it by refId instead.
  let wallet = await createCircleWallet(user.id).catch((err) => {
    console.error(err)
    return undefined
  })
  for (let attempt = 0; !wallet && attempt < 5; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    wallet = await findCircleWallet(user.id).catch(() => undefined)
  }
  if (!wallet) return reply(502, { error: 'Wallet service is unavailable, try again' })

  const { error: insertError } = await admin.from('wallets').upsert(
    { user_id: user.id, circle_wallet_id: wallet.id, address: wallet.address, blockchain: wallet.blockchain },
    { onConflict: 'user_id', ignoreDuplicates: true },
  )
  if (insertError) return reply(500, { error: 'Could not save wallet' })

  const { data: saved } = await admin
    .from('wallets').select('address, blockchain').eq('user_id', user.id).single()
  return walletResponse(saved!, true)
})
