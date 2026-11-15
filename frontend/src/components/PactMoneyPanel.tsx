import type { PactMoneyStatus, PactMoneyWallet, PactPaymentStatusRow } from '../types/pactMoney'

type Props = {
  pactName: string
  memberCount?: number
  status?: PactMoneyStatus
  wallet?: PactMoneyWallet | null
  error?: string | null
  walletEnabled?: boolean
  onCreateWallet?: () => Promise<unknown>
  paymentRows?: PactPaymentStatusRow[] | null
}

export function PactMoneyPanel({ pactName, memberCount = 0, status = 'unavailable', wallet = null, error = null, walletEnabled = false, onCreateWallet, paymentRows = null }: Props) {
  const hasWallet = Boolean(wallet)
  const isLoading = status === 'loading'
  const statusText = status === 'ready' && hasWallet ? 'CONNECTED' : status === 'error' ? 'ATTENTION' : 'PREPARING'
  const plan = paymentRows?.[0] || null
  const paidCount = paymentRows?.filter((row) => row.share_status === 'paid').length || 0
  const totalShares = plan?.shares_needed || paymentRows?.length || 0
  const amount = plan ? Number(plan.share_usdc) * plan.shares_needed : null
  const receiptCount = paymentRows?.filter((row) => row.tx_hash).length || 0

  return <section className="workspace-card money-panel" aria-labelledby="pact-money-heading">
    <div className="money-header"><div><p className="section-kicker">PACT / TREASURY</p><h2 id="pact-money-heading">PactMoney</h2><p>Shared funds and contributions for <strong>{pactName}</strong>.</p></div><span className={`money-status is-${status}`}><i />{statusText}</span></div>
    <div className="money-wallet-card"><div><span className="money-label">WALLET NETWORK</span><strong>Arc Testnet</strong></div><div className="money-wallet-value"><span className="money-label">WALLET ADDRESS</span><code>{wallet?.address || 'Wallet not connected'}</code></div><div className="money-wallet-value"><span className="money-label">USDC BALANCE</span><strong>{wallet?.usdcBalance ?? '—'}</strong></div><button className="gold-button money-create-button" type="button" onClick={() => { if (onCreateWallet) void onCreateWallet() }} disabled={!walletEnabled || isLoading || hasWallet}>{isLoading ? 'Creating wallet…' : hasWallet ? 'Wallet connected' : walletEnabled ? 'Create wallet' : 'Create wallet · backend pending'}</button></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="money-sections"><div><p className="money-label">FUNDING GOAL</p><strong>{plan ? `${amount?.toFixed(2)} USDC` : 'Not configured'}</strong><span>{plan ? `Arc Testnet · ${plan.payment_status}` : 'No verified PactSplit funding target is available yet.'}</span></div><div><p className="money-label">MEMBER SHARES</p><strong>{plan ? `${plan.share_usdc} USDC each` : `${memberCount} eligible member${memberCount === 1 ? '' : 's'}`}</strong><span>{plan ? `${totalShares} share${totalShares === 1 ? '' : 's'} · ${paidCount} verified paid` : 'Share amounts will appear after the payment plan is created.'}</span></div><div><p className="money-label">PAYMENT STATUS</p><strong>{plan ? `${paidCount}/${totalShares} paid` : 'Awaiting verification'}</strong><span>{plan ? 'Only persisted verified payment events count.' : 'Wallet balance is not treated as contribution proof.'}</span></div><div><p className="money-label">RECEIPTS</p><strong>{plan && receiptCount ? `${receiptCount} available` : 'Unavailable'}</strong><span>{plan && receiptCount ? 'Transaction references are available for verified shares.' : 'Receipts require persisted, verified transaction events.'}</span></div></div>
    <small className="money-note">{plan ? 'Funding data is read from the authorized Pact payment status service.' : 'PactSplit payment data is unavailable until the payment migration and verified event path are deployed.'}</small>
  </section>
}

