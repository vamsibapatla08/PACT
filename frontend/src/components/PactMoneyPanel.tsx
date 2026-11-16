import { useState, type FormEvent } from 'react'
import type { PactMoneyStatus, PactMoneyTransfer, PactMoneyWallet, PactPaymentStatusRow } from '../types/pactMoney'

export type PactMoneyRecipient = { userId: string; name: string }

const ARC_EXPLORER = 'https://explorer.testnet.arc.io/tx/'
const AMOUNT = /^\d+(\.\d{1,6})?$/
const TRANSFER_TEXT: Record<PactMoneyTransfer['status'], string> = { awaiting_pin: 'Waiting for your PIN…', pending: 'Sending on Arc…', confirmed: 'Sent', failed: 'Send failed' }

type Props = {
  pactName: string
  memberCount?: number
  status?: PactMoneyStatus
  wallet?: PactMoneyWallet | null
  error?: string | null
  walletEnabled?: boolean
  onCreateWallet?: () => Promise<unknown>
  onResetPin?: () => Promise<void>
  recipients?: PactMoneyRecipient[]
  onSend?: (toUserId: string, amount: string, onUpdate: (transfer: PactMoneyTransfer) => void) => Promise<PactMoneyTransfer>
  paymentRows?: PactPaymentStatusRow[] | null
  isHost?: boolean
  onCreateFundingPlan?: (input: { shareUsdc: string; deadline: string; payeeAddress: string }) => Promise<void>
}

export function PactMoneyPanel({ pactName, memberCount = 0, status = 'unavailable', wallet = null, error = null, walletEnabled = false, onCreateWallet, onResetPin, recipients = [], onSend, paymentRows = null, isHost = false, onCreateFundingPlan }: Props) {
  const [shareUsdc, setShareUsdc] = useState('')
  const [deadline, setDeadline] = useState('')
  const [payeeAddress, setPayeeAddress] = useState('')
  const [planLoading, setPlanLoading] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  const hasWallet = Boolean(wallet)
  const [toUserId, setToUserId] = useState('')
  const [amount, setAmount] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [transfer, setTransfer] = useState<PactMoneyTransfer | null>(null)
  const [resetting, setResetting] = useState(false)
  const [resetResult, setResetResult] = useState<{ ok: boolean; text: string } | null>(null)
  // A locked PIN can also block wallet setup, so the button shows then too.
  const canResetPin = Boolean(onResetPin) && (hasWallet || Boolean(error?.includes('Reset your PIN')))
  const recipientName = (userId: string) => recipients.find((r) => r.userId === userId)?.name ?? 'Pact member'

  async function handleSend(event: FormEvent) {
    event.preventDefault()
    if (!onSend || sending) return
    if (!toUserId) { setSendError('Choose who to send to.'); return }
    if (!AMOUNT.test(amount) || Number(amount) <= 0) { setSendError('Enter a USDC amount like 1 or 1.50.'); return }
    setSending(true); setSendError(null); setTransfer(null)
    try {
      setTransfer(await onSend(toUserId, amount, setTransfer))
    } catch (reason) {
      setSendError(reason instanceof Error ? reason.message : 'The send could not be completed.')
    } finally { setSending(false) }
  }

  async function handleResetPin() {
    if (!onResetPin || resetting) return
    setResetting(true); setResetResult(null)
    try {
      await onResetPin()
      setResetResult({ ok: true, text: 'Your new PIN is set.' })
    } catch (reason) {
      setResetResult({ ok: false, text: reason instanceof Error ? reason.message : 'The PIN reset could not be completed.' })
    } finally { setResetting(false) }
  }

  const isLoading = status === 'loading'
  const statusText = status === 'ready' && hasWallet ? 'CONNECTED' : status === 'error' ? 'ATTENTION' : 'PREPARING'
  const plan = paymentRows?.[0] || null
  const paidCount = paymentRows?.filter((row) => row.share_status === 'paid').length || 0
  const totalShares = plan?.shares_needed || paymentRows?.length || 0
  const fundingGoal = plan ? Number(plan.share_usdc) * plan.shares_needed : null
  const receiptCount = paymentRows?.filter((row) => row.tx_hash).length || 0

  return <section className="workspace-card money-panel" aria-labelledby="pact-money-heading">
    <div className="money-header"><div><p className="section-kicker">PACT / TREASURY</p><h2 id="pact-money-heading">PactMoney</h2><p>Shared funds and contributions for <strong>{pactName}</strong>.</p></div><span className={`money-status is-${status}`}><i />{statusText}</span></div>
    <div className="money-wallet-card"><div><span className="money-label">WALLET NETWORK</span><strong>Arc Testnet</strong></div><div className="money-wallet-value"><span className="money-label">WALLET ADDRESS</span><code>{wallet?.address || 'Wallet not connected'}</code></div><div className="money-wallet-value"><span className="money-label">USDC BALANCE</span><strong>{wallet?.usdcBalance ?? '—'}</strong></div><button className="gold-button money-create-button" type="button" onClick={() => { if (onCreateWallet) void onCreateWallet() }} disabled={!walletEnabled || isLoading || hasWallet}>{isLoading ? 'Creating wallet…' : hasWallet ? 'Wallet connected' : walletEnabled ? 'Create wallet' : 'Create wallet · backend pending'}</button></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {canResetPin ? <div className="money-pin-reset"><button className="outline-button" type="button" onClick={() => { void handleResetPin() }} disabled={resetting || sending}>{resetting ? 'Resetting PIN…' : 'Reset PIN'}</button>{resetResult ? <p className={resetResult.ok ? 'money-send-result is-confirmed' : 'form-error money-send-result'} role={resetResult.ok ? 'status' : 'alert'}>{resetResult.text}</p> : <span>Forgot your PIN? Answer your security questions to set a new one.</span>}</div> : null}
    {hasWallet && onSend ? <form className="money-send-card" onSubmit={handleSend}>
      <div><span className="money-label">SEND USDC TO</span><select value={toUserId} onChange={(e) => setToUserId(e.target.value)} disabled={sending || recipients.length === 0}><option value="">{recipients.length ? 'Choose a member' : 'No one else in this Pact yet'}</option>{recipients.map((r) => <option key={r.userId} value={r.userId}>{r.name}</option>)}</select></div>
      <div><span className="money-label">AMOUNT (USDC)</span><input inputMode="decimal" placeholder="1.00" value={amount} onChange={(e) => setAmount(e.target.value.trim())} disabled={sending} /></div>
      <button className="gold-button money-create-button" type="submit" disabled={sending || recipients.length === 0}>{sending ? 'Sending…' : 'Send USDC'}</button>
      {sendError ? <p className="form-error money-send-result" role="alert">{sendError}</p> : null}
      {transfer ? <p className={`money-send-result is-${transfer.status}`} role="status">{TRANSFER_TEXT[transfer.status]}: {transfer.amount} USDC to {recipientName(transfer.recipientId)}{transfer.txHash ? <> · <a href={ARC_EXPLORER + transfer.txHash} target="_blank" rel="noreferrer">View on Arc explorer</a></> : null}</p> : null}
    </form> : null}
    {!plan && isHost && onCreateFundingPlan ? <form className="money-plan-form" onSubmit={(event) => { event.preventDefault(); setPlanLoading(true); setPlanError(null); void onCreateFundingPlan({ shareUsdc, deadline, payeeAddress }).catch((reason) => setPlanError(reason instanceof Error ? reason.message : 'Funding plan could not be created.')).finally(() => setPlanLoading(false)) }}><p className="money-label">CREATE FUNDING PLAN</p><input aria-label="Share amount in USDC" inputMode="decimal" placeholder="Share amount in USDC" value={shareUsdc} onChange={(event) => setShareUsdc(event.target.value)} disabled={planLoading} required /><input aria-label="Funding deadline" type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} disabled={planLoading} required /><input aria-label="Payee wallet address" placeholder="Payee wallet address" value={payeeAddress} onChange={(event) => setPayeeAddress(event.target.value)} disabled={planLoading} required /><button className="gold-button" type="submit" disabled={planLoading || !wallet}>{planLoading ? 'Creating plan…' : 'Create funding plan'}</button>{!wallet ? <span>Connect the host wallet before configuring funding.</span> : null}{planError ? <p className="form-error" role="alert">{planError}</p> : null}</form> : null}
    <div className="money-sections"><div><p className="money-label">FUNDING GOAL</p><strong>{plan ? `${fundingGoal?.toFixed(2)} USDC` : 'Not configured'}</strong><span>{plan ? `Arc Testnet · ${plan.payment_status}` : 'No verified PactSplit funding target is available yet.'}</span></div><div><p className="money-label">MEMBER SHARES</p><strong>{plan ? `${plan.share_usdc} USDC each` : `${memberCount} eligible member${memberCount === 1 ? '' : 's'}`}</strong><span>{plan ? `${totalShares} share${totalShares === 1 ? '' : 's'} · ${paidCount} verified paid` : 'Share amounts will appear after the payment plan is created.'}</span></div><div><p className="money-label">PAYMENT STATUS</p><strong>{plan ? `${paidCount}/${totalShares} paid` : 'Awaiting verification'}</strong><span>{plan ? 'Only persisted verified payment events count.' : 'Wallet balance is not treated as contribution proof.'}</span></div><div><p className="money-label">RECEIPTS</p><strong>{plan && receiptCount ? `${receiptCount} available` : 'Unavailable'}</strong><span>{plan && receiptCount ? 'Transaction references are available for verified shares.' : 'Receipts require persisted, verified transaction events.'}</span></div></div>
    <small className="money-note">{plan ? 'Funding data is read from the authorized Pact payment status service.' : 'PactSplit payment data is unavailable until the payment migration and verified event path are deployed.'}</small>
  </section>
}

