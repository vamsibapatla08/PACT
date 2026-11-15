// The signed-in user's own Circle wallet on Arc Testnet (user-controlled: only their PIN moves money).
// The Circle user ID is the Supabase auth.uid(), so one wallet follows a person across every Pact.
//
//   GET  /functions/v1/wallet                                   status: read only, never creates
//   POST /functions/v1/wallet { "action": "status" }            same as GET
//   POST /functions/v1/wallet { "action": "start" }             returns what Circle's web SDK needs
//   POST /functions/v1/wallet { "action": "confirm", "challengeId": "..." }
//   POST /functions/v1/wallet { "action": "transfer", "to": "0x...", "amount": "1.50" }   send USDC to any address (own-wallet tests)
//   POST /functions/v1/wallet { "action": "transfer", "pactId": "<uuid>", "toUserId": "<uuid>", "amount": "1.50",
//                               "requestId": "<uuid>" }                                   send USDC to another member of the pact
//   POST /functions/v1/wallet { "action": "transfer_status", "transferId": "<uuid>" }     pending, confirmed or failed, with the tx hash
//   POST /functions/v1/wallet { "action": "pay_share", "pactId": "<uuid>" }               pay my share into PactSplit
//   POST /functions/v1/wallet { "action": "create_pact", "pactId": "<uuid>", "payee": "0x...", "shareUsdc": "25.00",
//                               "sharesNeeded": 4, "deadline": <unix seconds> }          host opens the pact on chain
//   POST /functions/v1/wallet { "action": "release", "pactId": "<uuid>" }                 host pays the payee once full
//   POST /functions/v1/wallet { "action": "cancel", "pactId": "<uuid>" }                  host stops the pact
//   POST /functions/v1/wallet { "action": "claim_refund", "pactId": "<uuid>" }            payer takes their share back after a cancel
//   POST /functions/v1/wallet { "action": "reset_pin" }                                   new PIN after answering the security questions
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

type Challenge = { userToken: string; encryptionKey: string; challengeId: string }

async function startChallenge(userId: string, path: string, body: Record<string, unknown>): Promise<Challenge> {
  const session = await userSession(userId)
  const { challengeId } = await circle(path, {
    method: 'POST',
    userToken: session.userToken,
    body: { idempotencyKey: crypto.randomUUID(), feeLevel: 'MEDIUM', ...body },
  })
  return { ...session, challengeId }
}

// Hands the client a PIN challenge for its Circle SDK. Nothing moves until the user enters their PIN.
// `details` goes back beside the challenge so the app can show what the PIN approves.
async function challengeReply(c: Challenge, details: Record<string, unknown> = {}) {
  return reply(200, {
    status: 'challenge',
    appId: await circleAppId(),
    userToken: c.userToken,
    encryptionKey: c.encryptionKey,
    challengeId: c.challengeId,
    ...details,
  })
}

async function challenge(userId: string, path: string, body: Record<string, unknown>, details: Record<string, unknown> = {}) {
  return challengeReply(await startChallenge(userId, path, body), details)
}

const isAmount = (amount: unknown): amount is string =>
  typeof amount === 'string' && /^\d+(\.\d{1,6})?$/.test(amount) && Number(amount) > 0

// USDC is Arc's native token, so a transfer sends the native token (empty tokenAddress).
async function transfer(userId: string, to: unknown, amount: unknown) {
  if (typeof to !== 'string' || !ADDRESS.test(to)) return reply(400, { error: 'to must be a 0x address' })
  if (!isAmount(amount)) return reply(400, { error: 'amount must be a USDC amount like "1.50"' })
  const id = await walletId(userId)
  if (!id) return reply(409, { error: 'Set up your wallet first' })
  return await challenge(userId, '/user/transactions/transfer', {
    walletId: id, destinationAddress: to, amounts: [amount], tokenAddress: '', blockchain: BLOCKCHAIN,
  })
}

type TransferRow = {
  transfer_id: string; pact_id: string; sender_id: string; recipient_id: string; recipient_address: string
  amount_usdc: number; request_id: string; circle_challenge_id: string | null; circle_transaction_id: string | null
  tx_hash: string | null; status: 'awaiting_pin' | 'pending' | 'confirmed' | 'failed'; created_at: string
}

const transferView = (t: TransferRow) => ({
  transferId: t.transfer_id, pactId: t.pact_id, senderId: t.sender_id, recipientId: t.recipient_id,
  to: t.recipient_address, amount: String(t.amount_usdc), status: t.status, txHash: t.tx_hash, createdAt: t.created_at,
})

// Both people must be active members of the pact, and the recipient's address comes from our wallets table,
// never from the app. The requestId makes a retry or double tap reuse the same send instead of a second one.
async function memberTransfer(userId: string, userJwt: string, body: Record<string, unknown>) {
  const { pactId, toUserId, amount, requestId } = body
  if (typeof pactId !== 'string' || !UUID.test(pactId)) return reply(400, { error: 'pactId must be a pact id' })
  if (typeof toUserId !== 'string' || !UUID.test(toUserId)) return reply(400, { error: 'toUserId must be a member id' })
  if (typeof requestId !== 'string' || !UUID.test(requestId)) return reply(400, { error: 'requestId must be a uuid made once per send' })
  if (!isAmount(amount)) return reply(400, { error: 'amount must be a USDC amount like "1.50"' })
  if (toUserId === userId) return reply(400, { error: 'You cannot send to yourself' })

  const roster = await pactRoster(userJwt, pactId)
  if (!roster.some((m) => m.user_id === userId)) return reply(403, { error: 'You are not in this pact' })
  if (!roster.some((m) => m.user_id === toUserId)) return reply(403, { error: 'They are not in this pact' })
  const id = await walletId(userId)
  if (!id) return reply(409, { error: 'Set up your wallet first' })
  const recipient = await savedWallet(toUserId)
  if (!recipient) return reply(409, { error: 'They have not set up a wallet yet' })

  const { error: insertError } = await admin.from('pact_transfers').insert({
    pact_id: pactId, sender_id: userId, recipient_id: toUserId, recipient_address: recipient.address,
    amount_usdc: amount, request_id: requestId,
  })
  if (insertError && insertError.code !== '23505') throw insertError // 23505: this requestId was already used
  const { data: row, error } = await admin.from('pact_transfers').select('*')
    .eq('sender_id', userId).eq('request_id', requestId).single()
  if (error) throw error
  const t = row as TransferRow
  if (t.pact_id !== pactId || t.recipient_id !== toUserId || Number(t.amount_usdc) !== Number(amount)) {
    return reply(409, { error: 'This requestId was used for a different send' })
  }
  if (t.status !== 'awaiting_pin') return reply(409, { error: 'This send was already approved', transfer: transferView(t) })

  // Reuse the open challenge on a retry; Circle also dedupes on the requestId if the first call never saved one.
  let c: Challenge
  if (t.circle_challenge_id) {
    c = { ...(await userSession(userId)), challengeId: t.circle_challenge_id }
  } else {
    c = await startChallenge(userId, '/user/transactions/transfer', {
      idempotencyKey: requestId, walletId: id, destinationAddress: t.recipient_address,
      amounts: [amount], tokenAddress: '', blockchain: BLOCKCHAIN,
    })
    const { error: saveError } = await admin.from('pact_transfers')
      .update({ circle_challenge_id: c.challengeId, updated_at: new Date().toISOString() }).eq('transfer_id', t.transfer_id)
    if (saveError) throw saveError
  }
  return challengeReply(c, { transferId: t.transfer_id, amount, to: t.recipient_address })
}

const CONFIRMED = new Set(['CONFIRMED', 'COMPLETE'])
const FAILED = new Set(['FAILED', 'CANCELLED', 'DENIED'])

// Follows the send through Circle: PIN challenge, then the transaction it made, then its on-chain state.
async function transferStatus(userId: string, transferId: unknown) {
  if (typeof transferId !== 'string' || !UUID.test(transferId)) return reply(400, { error: 'transferId must be a transfer id' })
  const { data, error } = await admin.from('pact_transfers').select('*').eq('transfer_id', transferId)
    .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`).maybeSingle()
  if (error) throw error
  if (!data) return reply(404, { error: 'No such transfer' })
  let t = data as TransferRow
  if (t.status === 'confirmed' || t.status === 'failed' || !t.circle_challenge_id) return reply(200, { transfer: transferView(t) })

  const { userToken } = await userSession(t.sender_id)
  const update: Partial<TransferRow> = {}
  let txId = t.circle_transaction_id
  if (!txId) {
    const { challenge } = await circle(`/user/challenges/${encodeURIComponent(t.circle_challenge_id)}`, { userToken })
    if (challenge.status === 'FAILED' || challenge.status === 'EXPIRED') update.status = 'failed'
    else if (challenge.status === 'COMPLETE') txId = update.circle_transaction_id = challenge.correlationIds?.[0] ?? null
  }
  if (txId) {
    const { transaction } = await circle(`/transactions/${encodeURIComponent(txId)}`, { userToken })
    update.status = CONFIRMED.has(transaction.state) ? 'confirmed' : FAILED.has(transaction.state) ? 'failed' : 'pending'
    update.tx_hash = transaction.txHash ?? null
  }
  if (Object.keys(update).length) {
    const { data: saved, error: saveError } = await admin.from('pact_transfers')
      .update({ ...update, updated_at: new Date().toISOString() }).eq('transfer_id', t.transfer_id).select('*').single()
    if (saveError) throw saveError
    t = saved as TransferRow
  }
  return reply(200, { transfer: transferView(t) })
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
  }, { amount: usdcString(pact.share), payee: pact.payee, sharesPaid: pact.sharesPaid, sharesNeeded: pact.sharesNeeded })
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
  if (fn === 'release' && pact.sharesPaid < pact.sharesNeeded) {
    return reply(409, { error: `Waiting for ${pact.sharesNeeded - pact.sharesPaid} more of ${pact.sharesNeeded} shares` })
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

  // Too many wrong PINs locks it, and /user/initialize refuses an initialized user.
  if (user.pinStatus === 'LOCKED') return reply(409, { error: PIN_LOCKED })

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

const PIN_LOCKED = 'Your PIN is locked after too many tries. Reset your PIN to continue.'

// Circle's own screen asks the security questions set with the first PIN, then takes a new PIN.
// This also unlocks a PIN locked by wrong tries.
async function resetPin(userId: string) {
  const session = await userSession(userId).catch((err) => {
    if (err instanceof CircleError && err.status < 500) return null // no Circle user yet
    throw err
  })
  if (!session) return reply(409, { error: 'Set up your wallet first' })
  const user = await circle('/user', { userToken: session.userToken })
  if (user.pinStatus !== 'ENABLED' && user.pinStatus !== 'LOCKED') return reply(409, { error: 'Set up your wallet first' })
  const { challengeId } = await circle('/user/pin/restore', {
    method: 'POST',
    userToken: session.userToken,
    body: { idempotencyKey: crypto.randomUUID() },
  })
  return challengeReply({ ...session, challengeId })
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
    if (action === 'start') return await start(user.id)
    if (action === 'confirm') return await confirm(user.id, body.challengeId)
    if (action === 'transfer') {
      return body.pactId === undefined ? await transfer(user.id, body.to, body.amount) : await memberTransfer(user.id, token!, body)
    }
    if (action === 'transfer_status') return await transferStatus(user.id, body.transferId)
    if (action === 'pay_share') return await payShare(user.id, token!, body.pactId)
    if (action === 'create_pact') return await createPact(user.id, token!, body)
    if (action === 'release' || action === 'cancel') return await closePact(user.id, token!, body.pactId, action)
    if (action === 'claim_refund') return await claimRefund(user.id, token!, body.pactId)
    if (action === 'reset_pin') return await resetPin(user.id)
    return reply(400, { error: 'action must be status, start, confirm, transfer, transfer_status, pay_share, create_pact, release, cancel, claim_refund or reset_pin' })
  } catch (err) {
    console.error(err instanceof Error ? err.message : 'wallet error')
    // Circle's code (never its body) goes back so a failure can be looked up instead of guessed at.
    if (err instanceof CircleError) {
      return reply(502, { error: `Circle refused the request (code ${err.code ?? err.status}), try again`, circleCode: err.code ?? null })
    }
    return reply(502, { error: 'Wallet service is unavailable, try again' })
  }
})
