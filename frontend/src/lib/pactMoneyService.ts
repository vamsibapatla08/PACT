import { supabase } from './supabase'
import type { PactMoneyWallet, PactPaymentStatusRow } from '../types/pactMoney'

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

async function invokeWallet<T>(action: 'status' | 'start' | 'confirm', challengeId?: string): Promise<T> {
  const { data, error } = await client().functions.invoke('wallet', { body: challengeId ? { action, challengeId } : { action } })
  if (error) throw error
  if (!data || typeof data !== 'object') throw new Error('Wallet service returned an invalid response.')
  return data as T
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
      if (error) { reject(new Error(error.message || 'Circle wallet setup failed.')); return }
      if (result?.status !== 'COMPLETE') { reject(new Error(result?.status ? `Circle wallet setup ended with ${result.status.toLowerCase()}.` : 'Circle wallet setup returned no successful result.')); return }
      resolve()
    })
  })
}

export async function createPactMoneyWallet(): Promise<PactMoneyWallet> {
  if (!pactMoneyWalletEnabled) throw new Error('Wallet creation is waiting for backend deployment and PIN-flow verification.')
  const challenge = await invokeWallet<WalletStartResponse>('start')
  if (challenge.status === 'ready') return toWallet(challenge)
  if (challenge.status !== 'challenge') throw new Error('Wallet setup did not return a Circle challenge.')

  // These short-lived values stay in this function's memory and are passed directly to Circle's SDK.
  const { W3SSdk } = await import('@circle-fin/w3s-pw-web-sdk')
  const sdk = new W3SSdk({ appSettings: { appId: challenge.appId } })
  await sdk.getDeviceId()
  sdk.setAuthentication({ userToken: challenge.userToken, encryptionKey: challenge.encryptionKey })
  await executeChallenge(sdk, challenge.challengeId)

  const confirmed = await invokeWallet<WalletStatusResponse>('confirm', challenge.challengeId)
  if (confirmed.status !== 'ready') throw new Error('error' in confirmed ? confirmed.error || 'Wallet setup is still pending confirmation.' : 'Wallet setup returned no wallet.')
  return toWallet(confirmed)
}

