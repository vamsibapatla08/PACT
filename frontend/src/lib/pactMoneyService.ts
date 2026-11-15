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

export async function getPactPaymentStatus(pactId: string): Promise<PactPaymentStatusRow[]> {
  const { data, error } = await client().rpc('get_pact_payment_status', { p_pact_id: pactId })
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('Payment service returned an invalid response.')
  return data as PactPaymentStatusRow[]
}

export function isPaymentBackendUnavailable(error: unknown): boolean {
  const value = error as { code?: string; message?: string } | null
  return value?.code === '42883' || value?.code === '42P01' || value?.code === 'PGRST202' || /function .*get_pact_payment_status|relation .*pact_(payments|shares)/i.test(value?.message || '')
}

async function invokeWallet<T>(action: 'status' | 'start' | 'confirm' | 'transfer' | 'transfer_status' | 'reset_pin', params: Record<string, unknown> = {}): Promise<T> {
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

function toWallet(data: Extract<WalletStatusResponse, { status: 'ready' }>): PactMoneyWallet {
  return { address: data.address, blockchain: data.blockchain, usdcBalance: data.usdc_balance }
}

export async function getPactMoneyWalletStatus(): Promise<PactMoneyWallet | null> {
  const data = await invokeWallet<WalletStatusResponse>('status')
  if (data.status === 'ready') return toWallet(data)
  if (data.status === 'none') return null
  throw new Error(data.error || 'Wallet status is not ready.')
}

type CircleChallengeResult = { status?: 'COMPLETE' | 'FAILED' | 'EXPIRED' | 'PENDING' | string }
type CircleSdk = { getDeviceId: () => Promise<string>; setAuthentication: (auth: { userToken: string; encryptionKey: string }) => void; execute: (challengeId: string, onCompleted: (error?: { message?: string }, result?: CircleChallengeResult) => void) => void }

function executeChallenge(sdk: CircleSdk, challengeId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sdk.execute(challengeId, (error, result) => {
      if (error) { reject(new Error(error.message || 'The Circle PIN step failed.')); return }
      if (result?.status !== 'COMPLETE') { reject(new Error(result?.status ? `The Circle PIN step ended with ${result.status.toLowerCase()}.` : 'The Circle PIN step returned no result.')); return }
      resolve()
    })
  })
}

// These short-lived values stay in this function's memory and are passed directly to Circle's SDK,
// which shows the PIN screen. Nothing moves until the PIN is entered.
async function runCircleChallenge(challenge: WalletChallengeResponse) {
  // The SDK is CommonJS, so dev builds only expose it under `default`.
  const circleModule = await import('@circle-fin/w3s-pw-web-sdk')
  const W3SSdk = circleModule.W3SSdk ?? (circleModule as unknown as { default: typeof circleModule }).default.W3SSdk
  const sdk = new W3SSdk({ appSettings: { appId: challenge.appId } })
  await sdk.getDeviceId()
  sdk.setAuthentication({ userToken: challenge.userToken, encryptionKey: challenge.encryptionKey })
  await executeChallenge(sdk, challenge.challengeId)
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
  await runCircleChallenge(challenge)
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

  // Arc confirms in seconds; give up watching after two minutes and leave it pending.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const transfer = await getPactMoneyTransfer(challenge.transferId)
    onUpdate(transfer)
    if (transfer.status === 'confirmed' || transfer.status === 'failed') return transfer
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
  return getPactMoneyTransfer(challenge.transferId)
}
