import { useState } from 'react'
import type { PactMoneyStatus, PactMoneyWallet, PactPaymentStatusRow } from '../types/pactMoney'

type Props = {
  pactName: string
  memberCount?: number
  status?: PactMoneyStatus
  wallet?: PactMoneyWallet | null
  error?: string | null
  walletEnabled?: boolean
  onCreateWallet?: () => Promise<unknown>
  onTransfer?: (to: string, amount: string) => Promise<void>
  paymentRows?: PactPaymentStatusRow[] | null
  isHost?: boolean
  onCreateFundingPlan?: (input: { shareUsdc: string; deadline: string; payeeAddress: string }) => Promise<void>
}

export function PactMoneyPanel({ pactName, memberCount = 0, status = 'unavailable', wallet = null, error = null, walletEnabled = false, onCreateWallet, onTransfer, paymentRows = null, isHost = false, onCreateFundingPlan }: Props) {
  const [shareUsdc, setShareUsdc] = useState('')
  const [deadline, setDeadline] = useState('')
  const [payeeAddress, setPayeeAddress] = useState('')
  const [planLoading, setPlanLoading] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  const [transferTo, setTransferTo] = useState('')
  const [transferAmount, setTransferAmount] = useState('')
  const [transferLoading, setTransferLoading] = useState(false)
  const [transferError, setTransferError] = useState<string | null>(null)
  const [transferNotice, setTransferNotice] = useState<string | null>(null)
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
    {wallet && walletEnabled && onTransfer ? <form className="money-send-card" onSubmit={(event) => { event.preventDefault(); setTransferLoading(true); setTransferError(null); setTransferNotice(null); void onTransfer(transferTo.trim(), transferAmount.trim()).then(() => setTransferNotice('Circle PIN approved. On-chain settlement status is not reported by the wallet endpoint.')).catch((reason) => setTransferError(reason instanceof Error ? reason.message : 'The transfer could not be completed.')).finally(() => setTransferLoading(false)) }}><div><span className="money-label">TRANSFER FUNDS</span><input aria-label="Recipient Arc wallet address" placeholder="Recipient Arc wallet address" value={transferTo} onChange={(event) => setTransferTo(event.target.value)} disabled={transferLoading} required /></div><div><span className="money-label">AMOUNT (USDC)</span><input aria-label="Transfer amount in USDC" inputMode="decimal" placeholder="1.00" value={transferAmount} onChange={(event) => setTransferAmount(event.target.value)} disabled={transferLoading} required /></div><button className="gold-button money-create-button" type="submit" disabled={transferLoading}>{transferLoading ? 'Approving…' : 'Transfer funds'}</button>{transferError ? <p className="form-error money-send-result" role="alert">{transferError}</p> : null}{transferNotice ? <p className="money-send-result" role="status">{transferNotice}</p> : null}</form> : null}
    {!plan && isHost && onCreateFundingPlan ? <form className="money-plan-form" onSubmit={(event) => { event.preventDefault(); setPlanLoading(true); setPlanError(null); void onCreateFundingPlan({ shareUsdc, deadline, payeeAddress }).catch((reason) => setPlanError(reason instanceof Error ? reason.message : 'Funding plan could not be created.')).finally(() => setPlanLoading(false)) }}><p className="money-label">CREATE FUNDING PLAN</p><input aria-label="Share amount in USDC" inputMode="decimal" placeholder="Share amount in USDC" value={shareUsdc} onChange={(event) => setShareUsdc(event.target.value)} disabled={planLoading} required /><input aria-label="Funding deadline" type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} disabled={planLoading} required /><input aria-label="Payee wallet address" placeholder="Payee wallet address" value={payeeAddress} onChange={(event) => setPayeeAddress(event.target.value)} disabled={planLoading} required /><button className="gold-button" type="submit" disabled={planLoading || !wallet}>{planLoading ? 'Creating plan…' : 'Create funding plan'}</button>{!wallet ? <span>Connect the host wallet before configuring funding.</span> : null}{planError ? <p className="form-error" role="alert">{planError}</p> : null}</form> : null}
    <div className="money-sections"><div><p className="money-label">FUNDING GOAL</p><strong>{plan ? `${amount?.toFixed(2)} USDC` : 'Not configured'}</strong><span>{plan ? `Arc Testnet · ${plan.payment_status}` : 'No verified PactSplit funding target is available yet.'}</span></div><div><p className="money-label">MEMBER SHARES</p><strong>{plan ? `${plan.share_usdc} USDC each` : `${memberCount} eligible member${memberCount === 1 ? '' : 's'}`}</strong><span>{plan ? `${totalShares} share${totalShares === 1 ? '' : 's'} · ${paidCount} verified paid` : 'Share amounts will appear after the payment plan is created.'}</span></div><div><p className="money-label">PAYMENT STATUS</p><strong>{plan ? `${paidCount}/${totalShares} paid` : 'Awaiting verification'}</strong><span>{plan ? 'Only persisted verified payment events count.' : 'Wallet balance is not treated as contribution proof.'}</span></div><div><p className="money-label">RECEIPTS</p><strong>{plan && receiptCount ? `${receiptCount} available` : 'Unavailable'}</strong><span>{plan && receiptCount ? 'Transaction references are available for verified shares.' : 'Receipts require persisted, verified transaction events.'}</span></div></div>
    <small className="money-note">{plan ? 'Funding data is read from the authorized Pact payment status service.' : 'PactSplit payment data is unavailable until the payment migration and verified event path are deployed.'}</small>
  </section>
}

