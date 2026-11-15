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

