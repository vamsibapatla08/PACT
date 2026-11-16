import { useState, type FormEvent } from 'react'
import type { PactMoneyStatus, PactMoneyTransfer, PactMoneyWallet, PactPaymentStatusRow } from '../types/pactMoney'
import type { PactAction } from '../lib/pactMoneyService'

export type PactMoneyRecipient = { userId: string; name: string; hasWallet?: boolean }

const ARC_EXPLORER = 'https://explorer.testnet.arc.io/tx/'
const AMOUNT = /^\d+(\.\d{1,6})?$/
const ACTION_LABEL: Record<PactAction, (share: number | string) => string> = {
  create_pact: () => 'Open on chain',
  pay_share: (share) => `Pay my share (${share} USDC)`,
  release: () => 'Release to payee',
  cancel: () => 'Cancel pact',
  claim_refund: (share) => `Claim my refund (${share} USDC)`,
}
const ACTION_DONE: Record<PactAction, string> = {
  create_pact: 'Opened on chain. Members can pay their shares now.',
  pay_share: 'Your share is paid.',
  release: 'Released to the payee.',
  cancel: 'Pact cancelled. Payers can claim refunds.',
  claim_refund: 'Your refund is back in your wallet.',
}
const CHAIN_TEXT: Record<string, string> = {
  none: 'The host has not opened this plan on chain yet.',
  open: 'Open for payments.',
  released: 'Released to the payee.',
  cancelled: 'Cancelled. Anyone who paid can claim a refund.',
}
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
  onSend?: (toUserId: string, amount: string, requestId: string, onUpdate: (transfer: PactMoneyTransfer) => void) => Promise<PactMoneyTransfer>
  paymentRows?: PactPaymentStatusRow[] | null
  isHost?: boolean
  onCreateFundingPlan?: (input: { shareUsdc: string; deadline: string; payeeAddress: string }) => Promise<void>
  currentUserId?: string
  onPactAction?: (action: PactAction) => Promise<string | null>
}

export function PactMoneyPanel({ pactName, memberCount = 0, status = 'unavailable', wallet = null, error = null, walletEnabled = false, onCreateWallet, onResetPin, recipients = [], onSend, paymentRows = null, isHost = false, onCreateFundingPlan, currentUserId, onPactAction }: Props) {
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
  // One requestId per send, kept across retries so a retry after an error reuses the same send on the server.
  // A new one only after that send finished, or when who or how much changes.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [acting, setActing] = useState<PactAction | null>(null)
  const [actionResult, setActionResult] = useState<{ ok: boolean; text: string; txHash?: string | null } | null>(null)
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
      const result = await onSend(toUserId, amount, requestId, setTransfer)
      setTransfer(result)
      if (result.status === 'confirmed' || result.status === 'failed') setRequestId(crypto.randomUUID())
    } catch (reason) {
      setSendError(reason instanceof Error ? reason.message : 'The send could not be completed.')
    } finally { setSending(false) }
  }

  async function handlePactAction(action: PactAction) {
    if (!onPactAction || acting) return
    setActing(action); setActionResult(null)
    try {
      const txHash = await onPactAction(action)
      setActionResult({ ok: true, text: ACTION_DONE[action], txHash })
    } catch (reason) {
      setActionResult({ ok: false, text: reason instanceof Error ? reason.message : 'That did not go through.' })
    } finally { setActing(null) }
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
  const chainState = plan?.payment_status
  const iPaid = paymentRows?.some((row) => row.user_id === currentUserId && row.share_status === 'paid') || false
  const pastDeadline = plan ? Date.parse(plan.deadline) < Date.now() : false
  const actions: PactAction[] = !plan || !hasWallet || !onPactAction ? []
    : chainState === 'none' ? (isHost ? ['create_pact'] : [])
    : chainState === 'open' ? [
      ...(!iPaid && !pastDeadline && paidCount < totalShares ? ['pay_share' as const] : []),
      ...(isHost && paidCount >= totalShares ? ['release' as const] : []),
      ...(isHost || pastDeadline ? ['cancel' as const] : []),
    ]
    : chainState === 'cancelled' && iPaid ? ['claim_refund'] : []

  return <section className="workspace-card money-panel" aria-labelledby="pact-money-heading">
    <div className="money-header"><div><p className="section-kicker">PACT / TREASURY</p><h2 id="pact-money-heading">PactMoney</h2><p>Shared funds and contributions for <strong>{pactName}</strong>.</p></div><span className={`money-status is-${status}`}><i />{statusText}</span></div>
    <div className="money-wallet-card"><div><span className="money-label">WALLET NETWORK</span><strong>Arc Testnet</strong></div><div className="money-wallet-value"><span className="money-label">WALLET ADDRESS</span><code>{wallet?.address || 'Wallet not connected'}</code></div><div className="money-wallet-value"><span className="money-label">USDC BALANCE</span><strong>{wallet?.usdcBalance ?? '—'}</strong></div><button className="gold-button money-create-button" type="button" onClick={() => { if (onCreateWallet) void onCreateWallet() }} disabled={!walletEnabled || isLoading || hasWallet}>{isLoading ? 'Creating wallet…' : hasWallet ? 'Wallet connected' : walletEnabled ? 'Create wallet' : 'Create wallet · backend pending'}</button></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {canResetPin ? <div className="money-pin-reset"><button className="outline-button" type="button" onClick={() => { void handleResetPin() }} disabled={resetting || sending}>{resetting ? 'Resetting PIN…' : 'Reset PIN'}</button>{resetResult ? <p className={resetResult.ok ? 'money-send-result is-confirmed' : 'form-error money-send-result'} role={resetResult.ok ? 'status' : 'alert'}>{resetResult.text}</p> : <span>Forgot your PIN? Answer your security questions to set a new one.</span>}</div> : null}
    {hasWallet && onSend ? <form className="money-send-card" onSubmit={handleSend}>
      <div><span className="money-label">SEND USDC TO</span><select value={toUserId} onChange={(e) => { setToUserId(e.target.value); setRequestId(crypto.randomUUID()) }} disabled={sending || recipients.length === 0}><option value="">{recipients.length ? 'Choose a member' : 'No one else in this Pact yet'}</option>{recipients.map((r) => <option key={r.userId} value={r.userId} disabled={r.hasWallet === false}>{r.name}{r.hasWallet === false ? ' · wallet not connected' : ''}</option>)}</select></div>
      <div><span className="money-label">AMOUNT (USDC)</span><input inputMode="decimal" placeholder="1.00" value={amount} onChange={(e) => { setAmount(e.target.value.trim()); setRequestId(crypto.randomUUID()) }} disabled={sending} /></div>
      <button className="gold-button money-create-button" type="submit" disabled={sending || recipients.length === 0}>{sending ? 'Sending…' : 'Send USDC'}</button>
      {sendError ? <p className="form-error money-send-result" role="alert">{sendError}</p> : null}
      {transfer ? <p className={`money-send-result is-${transfer.status}`} role="status">{TRANSFER_TEXT[transfer.status]}: {transfer.amount} USDC to {recipientName(transfer.recipientId)}{transfer.txHash ? <> · <a href={ARC_EXPLORER + transfer.txHash} target="_blank" rel="noreferrer">View on Arc explorer</a></> : null}</p> : null}
    </form> : null}
    {plan && onPactAction && hasWallet ? <div className="money-send-card">
      <span className="money-label">PACTSPLIT ON ARC</span>
      <span>{CHAIN_TEXT[chainState ?? 'none']}</span>
      {actions.map((action) => <button key={action} className={action === 'cancel' ? 'outline-button' : 'gold-button money-create-button'} type="button" onClick={() => { void handlePactAction(action) }} disabled={Boolean(acting) || sending}>{acting === action ? 'Waiting for Arc…' : ACTION_LABEL[action](plan.share_usdc)}</button>)}
      {actionResult ? <p className={actionResult.ok ? 'money-send-result is-confirmed' : 'form-error money-send-result'} role={actionResult.ok ? 'status' : 'alert'}>{actionResult.text}{actionResult.txHash ? <> · <a href={ARC_EXPLORER + actionResult.txHash} target="_blank" rel="noreferrer">View on Arc explorer</a></> : null}</p> : null}
    </div> : null}
    {(!plan || chainState === 'none') && isHost && onCreateFundingPlan ? <form className="money-plan-form" onSubmit={(event) => { event.preventDefault(); setPlanLoading(true); setPlanError(null); void onCreateFundingPlan({ shareUsdc, deadline, payeeAddress }).catch((reason) => setPlanError(reason instanceof Error ? reason.message : 'Funding plan could not be created.')).finally(() => setPlanLoading(false)) }}><p className="money-label">{plan ? 'REPLACE FUNDING PLAN (until it is opened on chain)' : 'CREATE FUNDING PLAN'}</p><input aria-label="Share amount in USDC" inputMode="decimal" placeholder="Share amount in USDC" value={shareUsdc} onChange={(event) => setShareUsdc(event.target.value)} disabled={planLoading} required /><input aria-label="Funding deadline" type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} disabled={planLoading} required /><input aria-label="Payee wallet address" placeholder="Payee wallet address" value={payeeAddress} onChange={(event) => setPayeeAddress(event.target.value)} disabled={planLoading} required /><button className="gold-button" type="submit" disabled={planLoading || !wallet}>{planLoading ? 'Saving plan…' : plan ? 'Replace funding plan' : 'Create funding plan'}</button>{!wallet ? <span>Connect the host wallet before configuring funding.</span> : null}{planError ? <p className="form-error" role="alert">{planError}</p> : null}</form> : null}
    <div className="money-sections"><div><p className="money-label">FUNDING GOAL</p><strong>{plan ? `${fundingGoal?.toFixed(2)} USDC` : 'Not configured'}</strong><span>{plan ? `Arc Testnet · ${plan.payment_status === 'none' ? 'not opened on chain yet' : plan.payment_status}` : 'No verified PactSplit funding target is available yet.'}</span></div><div><p className="money-label">MEMBER SHARES</p><strong>{plan ? `${plan.share_usdc} USDC each` : `${memberCount} eligible member${memberCount === 1 ? '' : 's'}`}</strong><span>{plan ? `${totalShares} share${totalShares === 1 ? '' : 's'} · ${paidCount} verified paid` : 'Share amounts will appear after the payment plan is created.'}</span></div><div><p className="money-label">PAYMENT STATUS</p><strong>{plan ? `${paidCount}/${totalShares} paid` : 'Awaiting verification'}</strong><span>{plan ? 'Only persisted verified payment events count.' : 'Wallet balance is not treated as contribution proof.'}</span></div><div><p className="money-label">RECEIPTS</p><strong>{plan && receiptCount ? `${receiptCount} available` : 'Unavailable'}</strong><span>{plan && receiptCount ? 'Transaction references are available for verified shares.' : 'Receipts require persisted, verified transaction events.'}</span></div></div>
    <small className="money-note">{plan ? 'Funding data is read from the authorized Pact payment status service.' : 'PactSplit payment data is unavailable until the payment migration and verified event path are deployed.'}</small>
  </section>
}

