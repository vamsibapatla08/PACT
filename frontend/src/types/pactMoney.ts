export type PactMoneyStatus = 'unavailable' | 'loading' | 'ready' | 'error'

export type PactMoneyWallet = {
  address: string
  blockchain: 'ARC-TESTNET'
  usdcBalance: string | null
}

export type PactMoneyTransfer = {
  transferId: string
  pactId: string
  senderId: string
  recipientId: string
  to: string
  amount: string
  status: 'awaiting_pin' | 'pending' | 'confirmed' | 'failed'
  txHash: string | null
  createdAt: string
}

export type PactMoneyDataSource = {
  createWallet: () => Promise<PactMoneyWallet>
  getWallet: () => Promise<PactMoneyWallet | null>
}

// 'none': the plan is saved but the host has not opened it on PactSplit yet.
export type PactPaymentStatus = 'none' | 'open' | 'released' | 'cancelled'
export type PactShareStatus = 'owed' | 'paid' | 'refunded'

export type PactPaymentStatusRow = {
  payment_id: string
  pact_id: string
  payee_address: string
  share_usdc: number | string
  shares_needed: number
  deadline: string
  chain_id: number
  contract_address: string
  payment_status: PactPaymentStatus
  share_id: string | null
  user_id: string | null
  wallet_address: string | null
  share_status: PactShareStatus | null
  amount_usdc: number | string | null
  tx_hash: string | null
  paid_at: string | null
  refunded_at: string | null
}

export type PactPaymentObligation = {
  payment_id: string
  pact_id: string
  user_id: string
  amount_usdc: number | string
  status: PactShareStatus
  allocation_version: number
  source_share_id: string | null
}

