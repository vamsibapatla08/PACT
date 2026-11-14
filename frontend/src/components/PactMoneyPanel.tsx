import type { PactMoneyStatus, PactMoneyWallet } from '../types/pactMoney'

type Props = {
  pactName: string
  status?: PactMoneyStatus
  wallet?: PactMoneyWallet | null
  error?: string | null
}

export function PactMoneyPanel({ pactName, status = 'unavailable', wallet = null, error = null }: Props) {
  const hasWallet = Boolean(wallet)
  const isLoading = status === 'loading'
  const statusText = status === 'ready' && hasWallet ? 'CONNECTED' : status === 'error' ? 'ATTENTION' : 'PREPARING'

  return <section className="workspace-card money-panel" aria-labelledby="pact-money-heading">
    <div className="money-header"><div><p className="section-kicker">PACT / TREASURY</p><h2 id="pact-money-heading">PactMoney</h2><p>Shared funds and contributions for <strong>{pactName}</strong>.</p></div><span className={`money-status is-${status}`}><i />{statusText}</span></div>
    <div className="money-wallet-card"><div><span className="money-label">WALLET NETWORK</span><strong>Arc Testnet</strong></div><div className="money-wallet-value"><span className="money-label">WALLET ADDRESS</span><code>{wallet?.address || 'Wallet not connected'}</code></div><div className="money-wallet-value"><span className="money-label">USDC BALANCE</span><strong>{wallet?.usdcBalance ?? '—'}</strong></div><button className="gold-button money-create-button" type="button" disabled>{isLoading ? 'Creating wallet…' : hasWallet ? 'Wallet connected' : 'Create wallet · backend pending'}</button></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="money-sections"><div><p className="money-label">SHARED EXPENSES</p><strong>No expenses recorded</strong><span>Expense tracking will appear when the payment backend is connected.</span></div><div><p className="money-label">MEMBER CONTRIBUTIONS</p><strong>Contributions unavailable</strong><span>Member balances require the confirmed wallet contract.</span></div><div><p className="money-label">PAYMENT STATUS</p><strong>Payments not connected</strong><span>No transfers or confirmations are being displayed.</span></div><div><p className="money-label">RECEIPTS</p><strong>No receipts yet</strong><span>Receipts will be available after transaction support is live.</span></div></div>
    <small className="money-note">Wallet creation and payment actions remain disabled until Rory’s user-controlled wallet contract is confirmed and deployed.</small>
  </section>
}

