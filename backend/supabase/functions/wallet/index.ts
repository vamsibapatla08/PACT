// The signed-in user's own Circle wallet on Arc Testnet (user-controlled: only their PIN moves money).
// The Circle user ID is the Supabase auth.uid(), so one wallet follows a person across every Pact.
//
//   GET  /functions/v1/wallet                                   status: read only, never creates
//   POST /functions/v1/wallet { "action": "status" }            same as GET
//   POST /functions/v1/wallet { "action": "start" }             returns what Circle's web SDK needs
//   POST /functions/v1/wallet { "action": "confirm", "challengeId": "..." }
//
// Calls Circle's REST API directly: its Node SDK fails to boot in the Edge runtime.
import { createClient } from 'npm:@supabase/supabase-js@2'

const BLOCKCHAIN = 'ARC-TESTNET'
const ARC_RPC = 'https://rpc.testnet.arc.network'
const CIRCLE_API = 'https://api.circle.com/v1/w3s'
const CIRCLE_API_KEY = Deno.env.get('CIRCLE_API_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

type CircleWallet = { id: string; address: string; blockchain: string; state: string; custodyType: string; userId?: string }
type WalletRow = { address: string; blockchain: string }

class CircleError extends Error {
  constructor(readonly status: number, readonly code: number | undefined, path: string) {
    super(`Circle ${path} ${status} (code ${code ?? 'none'})`)
  }
}

// Errors carry only the status and Circle's code, never response bodies, so tokens can't reach the logs.
async function circle(path: string, { method = 'GET', body, userToken }: { method?: string; body?: unknown; userToken?: string } = {}) {
  const headers: Record<string, string> = { Authorization: `Bearer ${CIRCLE_API_KEY}`, 'Content-Type': 'application/json' }
  if (userToken) headers['X-User-Token'] = userToken
  const res = await fetch(`${CIRCLE_API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new CircleError(res.status, json.code, path)
  return json.data
}

let appId: string | undefined
async function circleAppId() {
  appId ??= (await circle('/config/entity')).appId as string
  return appId
}

async function ensureCircleUser(userId: string) {
  try {
    await circle('/users', { method: 'POST', body: { userId } })
  } catch (err) {
    if (!(err instanceof CircleError && err.code === 155101)) throw err // 155101: user already exists
  }
}

async function userSession(userId: string): Promise<{ userToken: string; encryptionKey: string }> {
  return await circle('/users/token', { method: 'POST', body: { userId } })
}

// Without a valid user token Circle lists every wallet on the account, so each wallet is
// checked to be this user's own end-user wallet before it is trusted.
async function findUserWallet(userId: string, userToken: string): Promise<CircleWallet | undefined> {
  const { wallets } = await circle(`/wallets?blockchain=${BLOCKCHAIN}`, { userToken })
  return (wallets as CircleWallet[]).find((w) =>
    w.custodyType === 'ENDUSER' && w.state === 'LIVE' && w.blockchain === BLOCKCHAIN && (w.userId ?? userId) === userId
  )
}

async function saveWallet(userId: string, wallet: CircleWallet): Promise<WalletRow> {
  const { error } = await admin.from('wallets').upsert(
    { user_id: userId, circle_wallet_id: wallet.id, address: wallet.address, blockchain: wallet.blockchain },
    { onConflict: 'user_id', ignoreDuplicates: true },
  )
  if (error) throw error
  const { data } = await admin.from('wallets').select('address, blockchain').eq('user_id', userId).single()
  return data!
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

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

async function ready(row: WalletRow) {
  return reply(200, { status: 'ready', address: row.address, blockchain: row.blockchain, usdc_balance: await usdcBalance(row.address) })
}

async function savedWallet(userId: string) {
  const { data, error } = await admin.from('wallets').select('address, blockchain').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data as WalletRow | null
}

async function start(userId: string) {
  const saved = await savedWallet(userId)
  if (saved) return ready(saved)

  await ensureCircleUser(userId)
  const session = await userSession(userId)
  const user = await circle('/user', { userToken: session.userToken })

  let challengeId: string
  if (user.pinStatus === 'ENABLED') {
    // PIN already set: they may already have the wallet (confirm was missed), or need one on Arc.
    const existing = await findUserWallet(userId, session.userToken)
    if (existing) return ready(await saveWallet(userId, existing))
    challengeId = (await circle('/user/wallets', {
      method: 'POST',
      userToken: session.userToken,
      body: { idempotencyKey: crypto.randomUUID(), blockchains: [BLOCKCHAIN], accountType: 'EOA' },
    })).challengeId
  } else {
    challengeId = (await circle('/user/initialize', {
      method: 'POST',
      userToken: session.userToken,
      body: { idempotencyKey: crypto.randomUUID(), blockchains: [BLOCKCHAIN], accountType: 'EOA' },
    })).challengeId
  }

  return reply(200, {
    status: 'challenge',
    appId: await circleAppId(),
    userToken: session.userToken,
    encryptionKey: session.encryptionKey,
    challengeId,
  })
}

async function confirm(userId: string, challengeId: unknown) {
  const saved = await savedWallet(userId)
  if (saved) return ready(saved)
  if (typeof challengeId !== 'string' || !challengeId) return reply(400, { error: 'challengeId is required' })

  const { userToken } = await userSession(userId)
  const challenge = await circle(`/user/challenges/${encodeURIComponent(challengeId)}`, { userToken })
    .then((data) => data.challenge)
    .catch((err) => {
      if (err instanceof CircleError && err.status < 500) return null // not this user's challenge, or no such challenge
      throw err
    })
  if (!challenge || challenge.status === 'FAILED' || challenge.status === 'EXPIRED') {
    return reply(409, { status: 'failed', error: 'Wallet setup did not finish, start again' })
  }
  if (challenge.status !== 'COMPLETE') return reply(409, { status: 'pending', error: 'Finish the PIN step first' })

  // The wallet can take a moment to go live after the PIN step.
  for (let attempt = 0; attempt < 5; attempt++) {
    const wallet = await findUserWallet(userId, userToken)
    if (wallet) return ready(await saveWallet(userId, wallet))
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  return reply(409, { status: 'pending', error: 'Wallet is still being created, try again in a few seconds' })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'GET' && req.method !== 'POST') return reply(405, { error: 'Use GET or POST' })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  const { data: { user } } = token ? await admin.auth.getUser(token) : { data: { user: null } }
  if (!user) return reply(401, { error: 'Sign in first' })

  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
  const action = body.action ?? 'status'

  try {
    if (action === 'status') {
      const saved = await savedWallet(user.id)
      return saved ? ready(saved) : reply(200, { status: 'none' })
    }
    if (action === 'start') return await start(user.id)
    if (action === 'confirm') return await confirm(user.id, body.challengeId)
    return reply(400, { error: 'action must be status, start or confirm' })
  } catch (err) {
    console.error(err instanceof Error ? err.message : 'wallet error')
    return reply(502, { error: 'Wallet service is unavailable, try again' })
  }
})
