// The signed-in user's own Circle wallet on Arc Testnet (user-controlled: only their PIN moves money).
// The Circle user ID is the Supabase auth.uid(), so one wallet follows a person across every Pact.
//
//   GET  /functions/v1/wallet                                   status: read only, never creates
//   POST /functions/v1/wallet { "action": "status" }            same as GET
//   POST /functions/v1/wallet { "action": "start" }             returns what Circle's web SDK needs
//   POST /functions/v1/wallet { "action": "confirm", "challengeId": "..." }
//   POST /functions/v1/wallet { "action": "transfer", "to": "0x...", "amount": "1.50" }   send USDC, returns a PIN challenge
//   POST /functions/v1/wallet { "action": "pay_share", "pactId": "<uuid>" }               pay my share into PactSplit
//   POST /functions/v1/wallet { "action": "create_pact", "pactId": "<uuid>", "payee": "0x...", "shareUsdc": "25.00",
//                               "sharesNeeded": 4, "deadline": <unix seconds> }          host opens the pact on chain
//   POST /functions/v1/wallet { "action": "release", "pactId": "<uuid>" }                 host pays the payee once full
//   POST /functions/v1/wallet { "action": "cancel", "pactId": "<uuid>" }                  host stops the pact
//   POST /functions/v1/wallet { "action": "claim_refund", "pactId": "<uuid>" }            payer takes their share back after a cancel
//
// Calls Circle's REST API directly: its Node SDK fails to boot in the Edge runtime.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { decodeOpenPact, type OnChainPact, pactKey, PACTS_SELECTOR, usdcString, usdcWei } from './chain.ts'

const BLOCKCHAIN = 'ARC-TESTNET'
const ARC_RPC = 'https://rpc.testnet.arc.network'
const CIRCLE_API = 'https://api.circle.com/v1/w3s'
const CIRCLE_API_KEY = Deno.env.get('CIRCLE_API_KEY')!
const PACT_SPLIT_ADDRESS = Deno.env.get('PACT_SPLIT_ADDRESS')
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

// Reads PactSplit.pacts(key). Null when the pact is not open on chain.
async function openPact(key: string): Promise<OnChainPact | null> {
  const res = await fetch(ARC_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'eth_call',
      params: [{ to: PACT_SPLIT_ADDRESS, data: PACTS_SELECTOR + key.slice(2) }, 'latest'],
    }),
  })
  const { result } = await res.json()
  return decodeOpenPact(result)
}

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

async function ready(row: WalletRow) {
  return reply(200, { status: 'ready', address: row.address, blockchain: row.blockchain, usdc_balance: await usdcBalance(row.address) })
}

async function walletId(userId: string): Promise<string | null> {
  const { data, error } = await admin.from('wallets').select('circle_wallet_id').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data?.circle_wallet_id ?? null
}

// Hands the client a PIN challenge for its Circle SDK. Nothing moves until the user enters their PIN.
async function challenge(userId: string, path: string, body: Record<string, unknown>) {
  const session = await userSession(userId)
  const { challengeId } = await circle(path, {
    method: 'POST',
    userToken: session.userToken,
    body: { idempotencyKey: crypto.randomUUID(), feeLevel: 'MEDIUM', ...body },
  })
  return reply(200, {
    status: 'challenge',
    appId: await circleAppId(),
    userToken: session.userToken,
    encryptionKey: session.encryptionKey,
    challengeId,
  })
}

// USDC is Arc's native token, so a transfer sends the native token (empty tokenAddress).
async function transfer(userId: string, to: unknown, amount: unknown) {
  if (typeof to !== 'string' || !ADDRESS.test(to)) return reply(400, { error: 'to must be a 0x address' })
  if (typeof amount !== 'string' || !/^\d+(\.\d{1,6})?$/.test(amount) || Number(amount) <= 0) {
    return reply(400, { error: 'amount must be a USDC amount like "1.50"' })
  }
  const id = await walletId(userId)
  if (!id) return reply(409, { error: 'Set up your wallet first' })
  return await challenge(userId, '/user/transactions/transfer', {
    walletId: id, destinationAddress: to, amounts: [amount], tokenAddress: '', blockchain: BLOCKCHAIN,
  })
}

async function pactMemberWallets(userId: string, userJwt: string, pactId: unknown) {
  if (typeof pactId !== 'string' || !UUID.test(pactId)) return reply(400, { error: 'pactId must be a pact id' })
  const roster = await pactRoster(userJwt, pactId)
  if (!roster.some((member) => member.user_id === userId)) return reply(403, { error: 'You are not in this pact' })
  const { data, error } = await admin
    .from('wallets')
    .select('user_id, address')
    .in('user_id', roster.map((member) => member.user_id))
  if (error) throw error
  return reply(200, { members: data ?? [] })
}

// list_pact_members runs as the caller and returns rows only to active members, so it checks
// membership and finds the real host in one call.
async function pactRoster(userJwt: string, pactId: string) {
  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  })
  const { data: members, error } = await asUser.rpc('list_pact_members', { p_pact_id: pactId })
  if (error) throw error
  return (members ?? []) as { user_id: string; role: string }[]
}

async function payShare(userId: string, userJwt: string, pactId: unknown) {
  if (!PACT_SPLIT_ADDRESS) return reply(503, { error: 'Payments are not set up yet' })
  if (typeof pactId !== 'string' || !UUID.test(pactId)) return reply(400, { error: 'pactId must be a pact id' })

  const roster = await pactRoster(userJwt, pactId)
  if (!roster.some((m) => m.user_id === userId)) return reply(403, { error: 'You are not in this pact' })
  const hostId = roster.find((m) => m.role === 'host')?.user_id
  const hostWallet = hostId ? await savedWallet(hostId) : null

  const id = await walletId(userId)
  if (!id) return reply(409, { error: 'Set up your wallet first' })
  const key = pactKey(pactId)
  const pact = await openPact(key)
  if (!pact) return reply(409, { error: 'This pact is not open for payment' })
  // Anyone can call createPact with a known id, so only pay into the one the real host opened.
  if (!hostWallet || pact.host.toLowerCase() !== hostWallet.address.toLowerCase()) {
    return reply(409, { error: 'This pact was not opened by its host' })
  }

  return await challenge(userId, '/user/transactions/contractExecution', {
    walletId: id,
    contractAddress: PACT_SPLIT_ADDRESS,
    abiFunctionSignature: 'payShare(bytes32)',
    abiParameters: [key],
    amount: usdcString(pact.share),
  })
}

// Only the pact's active host may open, release or cancel it. Returns their Circle wallet id, or the error reply.
async function hostWalletId(userId: string, userJwt: string, pactId: string): Promise<string | Response> {
  const roster = await pactRoster(userJwt, pactId)
  if (!roster.some((m) => m.user_id === userId && m.role === 'host')) return reply(403, { error: 'Only the host can do this' })
  const id = await walletId(userId)
  return id ?? reply(409, { error: 'Set up your wallet first' })
}

// The host opens the pact from their own wallet, so PactSplit records that wallet as the host,
// which is what pay_share checks before anyone pays in.
async function createPact(userId: string, userJwt: string, body: Record<string, unknown>) {
  if (!PACT_SPLIT_ADDRESS) return reply(503, { error: 'Payments are not set up yet' })
  const { pactId, payee, shareUsdc, sharesNeeded, deadline } = body
  if (typeof pactId !== 'string' || !UUID.test(pactId)) return reply(400, { error: 'pactId must be a pact id' })
  if (typeof payee !== 'string' || !ADDRESS.test(payee)) return reply(400, { error: 'payee must be a 0x address' })
  const share = usdcWei(shareUsdc)
  if (!share || share >= 2n ** 128n) return reply(400, { error: 'shareUsdc must be a USDC amount like "25.00"' })
  if (typeof sharesNeeded !== 'number' || !Number.isInteger(sharesNeeded) || sharesNeeded < 1 || sharesNeeded > 2 ** 32 - 1) {
    return reply(400, { error: 'sharesNeeded must be a whole number of shares' })
  }
  if (typeof deadline !== 'number' || !Number.isSafeInteger(deadline) || deadline <= Date.now() / 1000) {
    return reply(400, { error: 'deadline must be a future time in unix seconds' })
  }

  const id = await hostWalletId(userId, userJwt, pactId)
  if (id instanceof Response) return id
  const key = pactKey(pactId)
  if (await openPact(key)) return reply(409, { error: 'This pact is already open on chain' })

  return await challenge(userId, '/user/transactions/contractExecution', {
    walletId: id,
    contractAddress: PACT_SPLIT_ADDRESS,
    abiFunctionSignature: 'createPact(bytes32,address,uint128,uint32,uint64)',
    abiParameters: [key, payee, share.toString(), String(sharesNeeded), String(deadline)],
  })
}

// release sends the total to the payee once every share is in; cancel lets each payer claim their share back.
async function closePact(userId: string, userJwt: string, pactId: unknown, fn: 'release' | 'cancel') {
  if (!PACT_SPLIT_ADDRESS) return reply(503, { error: 'Payments are not set up yet' })
  if (typeof pactId !== 'string' || !UUID.test(pactId)) return reply(400, { error: 'pactId must be a pact id' })

  const id = await hostWalletId(userId, userJwt, pactId)
  if (id instanceof Response) return id
  const key = pactKey(pactId)
  const pact = await openPact(key)
  if (!pact) return reply(409, { error: 'This pact is not open' })
  const wallet = await savedWallet(userId)
  if (!wallet || pact.host.toLowerCase() !== wallet.address.toLowerCase()) {
    return reply(409, { error: 'This pact was opened from another wallet' })
  }

  return await challenge(userId, '/user/transactions/contractExecution', {
    walletId: id,
    contractAddress: PACT_SPLIT_ADDRESS,
    abiFunctionSignature: `${fn}(bytes32)`,
    abiParameters: [key],
  })
}

// After a cancel, each payer pulls their own share back. PactSplit itself refuses anyone who did not pay.
async function claimRefund(userId: string, userJwt: string, pactId: unknown) {
  if (!PACT_SPLIT_ADDRESS) return reply(503, { error: 'Payments are not set up yet' })
  if (typeof pactId !== 'string' || !UUID.test(pactId)) return reply(400, { error: 'pactId must be a pact id' })

  const roster = await pactRoster(userJwt, pactId)
  if (!roster.some((m) => m.user_id === userId)) return reply(403, { error: 'You are not in this pact' })
  const id = await walletId(userId)
  if (!id) return reply(409, { error: 'Set up your wallet first' })

  return await challenge(userId, '/user/transactions/contractExecution', {
    walletId: id,
    contractAddress: PACT_SPLIT_ADDRESS,
    abiFunctionSignature: 'claimRefund(bytes32)',
    abiParameters: [pactKey(pactId)],
  })
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
    return reply(200, { status: 'failed', error: 'Wallet setup did not finish, start again' })
  }
  if (challenge.status !== 'COMPLETE') return reply(200, { status: 'pending', error: 'Finish the PIN step first' })

  // The wallet can take a moment to go live after the PIN step.
  for (let attempt = 0; attempt < 5; attempt++) {
    const wallet = await findUserWallet(userId, userToken)
    if (wallet) return ready(await saveWallet(userId, wallet))
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  return reply(200, { status: 'pending', error: 'Wallet is still being created, try again in a few seconds' })
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
    if (action === 'pact_member_wallets') return await pactMemberWallets(user.id, token!, body.pactId)
    if (action === 'start') return await start(user.id)
    if (action === 'confirm') return await confirm(user.id, body.challengeId)
    if (action === 'transfer') return await transfer(user.id, body.to, body.amount)
    if (action === 'pay_share') return await payShare(user.id, token!, body.pactId)
    if (action === 'create_pact') return await createPact(user.id, token!, body)
    if (action === 'release' || action === 'cancel') return await closePact(user.id, token!, body.pactId, action)
    if (action === 'claim_refund') return await claimRefund(user.id, token!, body.pactId)
    return reply(400, { error: 'action must be status, start, confirm, transfer, pay_share, create_pact, release, cancel or claim_refund' })
  } catch (err) {
    console.error(err instanceof Error ? err.message : 'wallet error')
    return reply(502, { error: 'Wallet service is unavailable, try again' })
  }
})
