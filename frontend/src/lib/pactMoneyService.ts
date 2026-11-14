import { supabase } from './supabase'
import type { PactMoneyWallet } from '../types/pactMoney'

// Keep live wallet creation off until Rory confirms deployment and the full PIN flow.
export const pactMoneyWalletEnabled = false

type WalletStatusResponse =
  | { status: 'none' }
  | { status: 'ready'; address: string; blockchain: 'ARC-TESTNET'; usdc_balance: string | null }
  | { status: 'pending' | 'failed'; error?: string }

type WalletChallengeResponse = { status: 'challenge'; appId: string; userToken: string; encryptionKey: string; challengeId: string }

function client() {
  if (!supabase) throw new Error('Pact is not connected to Supabase yet.')
  return supabase
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

type CircleSdk = { getDeviceId: () => Promise<string>; setAuthentication: (auth: { userToken: string; encryptionKey: string }) => void; execute: (challengeId: string, onCompleted: (error?: { message?: string }) => void) => void }

function executeChallenge(sdk: CircleSdk, challengeId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sdk.execute(challengeId, (error) => error ? reject(new Error(error.message || 'Circle wallet setup failed.')) : resolve())
  })
}

export async function createPactMoneyWallet(): Promise<PactMoneyWallet> {
  if (!pactMoneyWalletEnabled) throw new Error('Wallet creation is waiting for backend deployment and PIN-flow verification.')
  const challenge = await invokeWallet<WalletChallengeResponse>('start')
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

