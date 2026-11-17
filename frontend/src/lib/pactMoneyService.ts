import { supabase } from './supabase'
import type { PactMoneyTransfer, PactMoneyWallet, PactPaymentStatusRow } from '../types/pactMoney'

// Local development is enabled; deployed builds require an explicit opt-in.
export const pactMoneyWalletEnabled = import.meta.env.DEV
  || import.meta.env.VITE_PACTMONEY_WALLET_TEST === 'true'

type WalletStatusResponse =
  | { status: 'none' }
  | { status: 'ready'; address: string; blockchain: 'ARC-TESTNET'; usdc_balance: string | null }
  | { status: 'pending' | 'failed'; error?: string }

type WalletChallengeResponse = { status: 'challenge'; appId: string; userToken: string; encryptionKey: string; challengeId: string }
type WalletStartResponse = WalletChallengeResponse | Extract<WalletStatusResponse, { status: 'ready' }>

function client() {
  if (!supabase) throw new Error('Pact is not connected to Supabase yet.')
  return supabase
}

type OnChainStatus = {
  state: 'none' | 'open' | 'released' | 'cancelled'
  members: { userId: string; address: string | null; paid: boolean }[]
}

// The plan comes from the database; who has paid comes live from PactSplit through the wallet's pact_status,
// since nothing writes on-chain payments back to pact_shares. A plan the host has not opened on chain yet reads
// as 'none'. If the chain can't be read, the plan shows as saved.
export async function getPactPaymentStatus(pactId: string): Promise<PactPaymentStatusRow[]> {
  const { data, error } = await client().rpc('get_pact_payment_status', { p_pact_id: pactId })
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('Payment service returned an invalid response.')
  const rows = data as PactPaymentStatusRow[]
  if (!rows.length) return rows
  const chain = await invokeWallet<OnChainStatus>('pact_status', { pactId }).catch(() => null)
  if (!chain) return rows
  const state = chain.state
  const byUser = new Map(chain.members.map((m) => [m.userId, m]))
  return rows.map((row) => {
    const member = row.user_id ? byUser.get(row.user_id) : undefined
    return {
      ...row,
      payment_status: state,
      wallet_address: member?.address ?? row.wallet_address,
      share_status: member?.paid ? 'paid' : row.share_status,
    }
  })
}

export async function createPactFundingPlan(input: { pactId: string; shareUsdc: string; deadline: string; payeeAddress: string }): Promise<{ paymentId: string; sharesNeeded: number }> {
  const { data, error } = await client().functions.invoke('create-pact-payment-plan', { body: input })
  if (error) throw error
  if (!data || typeof data.paymentId !== 'string' || typeof data.sharesNeeded !== 'number') throw new Error('Funding plan service returned an invalid response.')
  return data as { paymentId: string; sharesNeeded: number }
}

export function isPaymentBackendUnavailable(error: unknown): boolean {
  const value = error as { code?: string; message?: string } | null
  return value?.code === '42883' || value?.code === '42P01' || value?.code === 'PGRST202' || /function .*get_pact_payment_status|relation .*pact_(payments|shares)/i.test(value?.message || '')
}

async function invokeWallet<T>(action: 'status' | 'start' | 'confirm' | 'transfer' | 'transfer_status' | 'reset_pin' | 'pact_status' | 'challenge_status' | 'pact_member_wallets' | PactAction, params: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client().functions.invoke('wallet', { body: { action, ...params } })
  if (error) throw new Error(await walletErrorMessage(error))
  if (!data || typeof data !== 'object') throw new Error('Wallet service returned an invalid response.')
  return data as T
}

// The wallet function puts a readable reason in `error` on 4xx replies, like "They have not set up a wallet yet".
async function walletErrorMessage(error: unknown) {
  const response = (error as { context?: unknown }).context
  if (response instanceof Response) {
    const body = await response.clone().json().catch(() => null) as { error?: unknown } | null
    if (typeof body?.error === 'string') return body.error
  }
  return error instanceof Error ? error.message : 'Wallet service is unavailable, try again.'
}

export async function payPactShare(pactId: string): Promise<void> {
  const challenge = await invokeWallet<WalletChallengeResponse>('pay_share', { pactId })
  if (challenge.status !== 'challenge') throw new Error('Paying your share did not return a Circle PIN challenge.')
  await runCircleChallenge(challenge)
}

function toWallet(data: Extract<WalletStatusResponse, { status: 'ready' }>): PactMoneyWallet {
  return { address: data.address, blockchain: data.blockchain, usdcBalance: data.usdc_balance }
}

export async function getPactMoneyWalletStatus(): Promise<PactMoneyWallet | null> {
  const data = await invokeWallet<WalletStatusResponse>('status')
  if (data.status === 'ready') return toWallet(data)
  if (data.status === 'none') return null
  throw new Error(data.error || 'Wallet status is not ready.')
}

export type PactMemberWallet = { user_id: string; address: string }

export async function getPactMemberWallets(pactId: string): Promise<PactMemberWallet[]> {
  const data = await invokeWallet<{ members: PactMemberWallet[] }>('pact_member_wallets', { pactId })
  if (!Array.isArray(data.members)) throw new Error('Pact member wallet data was invalid.')
  return data.members.filter((member) => typeof member?.user_id === 'string' && typeof member?.address === 'string')
}

type CircleChallengeResult = { status?: 'COMPLETE' | 'FAILED' | 'EXPIRED' | 'PENDING' | string }
type CircleSdk = { getDeviceId: () => Promise<string>; setAuthentication: (auth: { userToken: string; encryptionKey: string }) => void; setOnForgotPin: (onForgotPin: () => void, shouldCloseModalOnForgotPin?: boolean) => void; execute: (challengeId: string, onCompleted: (error?: { message?: string }, result?: CircleChallengeResult) => void) => void }

// Thrown when the user taps "Forgot PIN?" on Circle's PIN screen, which closes it without finishing the challenge.
class ForgotPinError extends Error {}

function executeChallenge(sdk: CircleSdk, challengeId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sdk.setOnForgotPin(() => reject(new ForgotPinError('Forgot PIN')), true)
    sdk.execute(challengeId, (error, result) => {
      if (error) { reject(new Error(error.message || 'The Circle PIN step failed.')); return }
      if (result?.status !== 'COMPLETE') { reject(new Error(result?.status ? `The Circle PIN step ended with ${result.status.toLowerCase()}.` : 'The Circle PIN step returned no result.')); return }
      resolve()
    })
  })
}

// These short-lived values stay in this function's memory and are passed directly to Circle's SDK,
// which shows the PIN screen. Nothing moves until the PIN is entered.
// "Forgot PIN?" on that screen runs the same reset as the Reset PIN button, then asks the user to try again,
// since the challenge it closed never ran.
async function runCircleChallenge(challenge: WalletChallengeResponse, { resetOnForgotPin = true } = {}) {
  // The SDK is CommonJS, so dev builds only expose it under `default`.
  const circleModule = await import('@circle-fin/w3s-pw-web-sdk')
  const W3SSdk = circleModule.W3SSdk ?? (circleModule as unknown as { default: typeof circleModule }).default.W3SSdk
  const sdk = new W3SSdk({ appSettings: { appId: challenge.appId } })
  await sdk.getDeviceId()
  sdk.setAuthentication({ userToken: challenge.userToken, encryptionKey: challenge.encryptionKey })
  try {
    await executeChallenge(sdk, challenge.challengeId)
  } catch (error) {
    if (!(error instanceof ForgotPinError)) throw error
    if (!resetOnForgotPin) throw new Error('PIN reset was stopped. Try Reset PIN again.')
    await resetPactMoneyPin()
    throw new Error('Your PIN is reset. Try again with your new PIN.')
  }
}

export async function createPactMoneyWallet(): Promise<PactMoneyWallet> {
  if (!pactMoneyWalletEnabled) throw new Error('Wallet creation is waiting for backend deployment and PIN-flow verification.')
  const challenge = await invokeWallet<WalletStartResponse>('start')
  if (challenge.status === 'ready') return toWallet(challenge)
  if (challenge.status !== 'challenge') throw new Error('Wallet setup did not return a Circle challenge.')

  await runCircleChallenge(challenge)

  const confirmed = await invokeWallet<WalletStatusResponse>('confirm', { challengeId: challenge.challengeId })
  if (confirmed.status !== 'ready') throw new Error('error' in confirmed ? confirmed.error || 'Wallet setup is still pending confirmation.' : 'Wallet setup returned no wallet.')
  return toWallet(confirmed)
}

// Circle's screen asks the security questions from wallet setup, then takes a new PIN. Also unlocks a locked PIN.
export async function resetPactMoneyPin(): Promise<void> {
  const challenge = await invokeWallet<WalletChallengeResponse>('reset_pin')
  if (challenge.status !== 'challenge') throw new Error('PIN reset did not return a Circle challenge.')
  await runCircleChallenge(challenge, { resetOnForgotPin: false })
}

type TransferReply = { transfer: PactMoneyTransfer }
type TransferChallengeResponse = WalletChallengeResponse & { transferId: string; amount: string; to: string }

export function getPactMoneyTransfer(transferId: string): Promise<PactMoneyTransfer> {
  return invokeWallet<TransferReply>('transfer_status', { transferId }).then((data) => data.transfer)
}

// Sends USDC to another member of the pact. The server checks you are both members and looks up
// their address itself. One requestId per Send tap, so a retry never sends twice.
export async function sendPactMoney(pactId: string, toUserId: string, amount: string, requestId: string, onUpdate: (transfer: PactMoneyTransfer) => void): Promise<PactMoneyTransfer> {
  const challenge = await invokeWallet<TransferChallengeResponse>('transfer', { pactId, toUserId, amount, requestId })
  if (challenge.status !== 'challenge') throw new Error('The send did not return a Circle PIN challenge.')
  await runCircleChallenge(challenge)

  // Arc confirms in seconds; give up watching after two minutes and leave it pending. A failed status check
  // is retried, never reported as a failed send: the PIN was accepted, so the money may already be moving.
  let last: PactMoneyTransfer | null = null
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const transfer = await getPactMoneyTransfer(challenge.transferId).catch(() => null)
    if (transfer) {
      last = transfer
      onUpdate(transfer)
      if (transfer.status === 'confirmed' || transfer.status === 'failed') return transfer
    }
    await sleep(3000)
  }
  if (last) return last
  throw new Error('The send was approved but its status could not be read. Check your balance before sending again.')
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export type PactAction = 'create_pact' | 'pay_share' | 'release' | 'cancel' | 'claim_refund'
type ChallengeProgress = { status: 'awaiting_pin' | 'pending' | 'confirmed' | 'failed'; txHash: string | null; error?: string }

type VerifiedPactEvent = { accepted: boolean; eventType: string; pactId: string; txHash: string; logIndex: number; confirmations: number }

export class PactVerificationError extends Error {
  constructor(message: string, readonly pactId: string, readonly eventType: 'paid' | 'released' | 'cancelled' | 'refunded', readonly txHash: string, readonly pending: boolean) {
    super(message)
    this.name = 'PactVerificationError'
  }
}

export async function verifyPactEvent(pactId: string, eventType: 'paid' | 'released' | 'cancelled' | 'refunded', txHash: string): Promise<VerifiedPactEvent> {
  const { data, error } = await client().functions.invoke('verify-pact-event', {
    body: { source: 'direct_rpc', pactId, eventType, txHash },
  })
  if (error) throw new Error(await walletErrorMessage(error))
  if (!data || data.accepted !== true || data.pactId !== pactId || data.txHash !== txHash) throw new Error('The Arc event was not verified.')
  return data as VerifiedPactEvent
}

// Runs one PactSplit action from the user's wallet: the server checks it would go through, the user enters
// their PIN, then this waits until Arc confirms it. Returns the tx hash; throws if it failed.
export async function runPactAction(action: PactAction, pactId: string): Promise<string | null> {
  const challenge = await invokeWallet<WalletChallengeResponse>(action, { pactId })
  if (challenge.status !== 'challenge') throw new Error('The wallet did not return a Circle PIN challenge.')
  await runCircleChallenge(challenge)
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const progress = await invokeWallet<ChallengeProgress>('challenge_status', { challengeId: challenge.challengeId }).catch(() => null)
    if (progress?.status === 'confirmed') {
      const eventType = action === 'pay_share' ? 'paid' : action === 'release' ? 'released' : action === 'cancel' ? 'cancelled' : action === 'claim_refund' ? 'refunded' : null
      if (eventType && progress.txHash) {
        try { await verifyPactEvent(pactId, eventType, progress.txHash) }
        catch (reason) {
          const message = reason instanceof Error ? reason.message : 'PACT verification failed.'
          throw new PactVerificationError(`Arc transaction confirmed, but PACT verification is ${/confirm|await|pending/i.test(message) ? 'pending' : 'failed'}: ${message}`, pactId, eventType, progress.txHash, /confirm|await|pending/i.test(message))
        }
      }
      if (eventType && !progress.txHash) throw new Error('Arc transaction confirmed, but no transaction hash was returned for PACT verification.')
      return progress.txHash
    }
    if (progress?.status === 'failed') throw new Error(progress.error || 'The transaction failed on Arc.')
    await sleep(3000)
  }
  throw new Error('Approved, but Arc has not confirmed it yet. Refresh in a minute.')
}

export async function retryPactEventVerification(pactId: string, eventType: PactVerificationError['eventType'], txHash: string) {
  return verifyPactEvent(pactId, eventType, txHash)
}
