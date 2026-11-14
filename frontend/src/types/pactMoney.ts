export type PactMoneyStatus = 'unavailable' | 'loading' | 'ready' | 'error'

export type PactMoneyWallet = {
  address: string
  blockchain: 'ARC-TESTNET'
  usdcBalance: string | null
}

export type PactMoneyDataSource = {
  createWallet: () => Promise<PactMoneyWallet>
  getWallet: () => Promise<PactMoneyWallet | null>
}

