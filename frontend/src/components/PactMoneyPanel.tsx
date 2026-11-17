import { useEffect, useState, type FormEvent } from 'react'
import type { PactMoneyStatus, PactMoneyTransfer, PactMoneyWallet, PactPaymentStatusRow } from '../types/pactMoney'
import type { PactAction } from '../lib/pactMoneyService'
import { PactVerificationError } from '../lib/pactMoneyService'

export type PactMoneyRecipient = { userId: string; name: string; hasWallet?: boolean; address?: string }
export type PactMoneyMember = { userId: string; name: string }

const OTHER_PAYEE = 'other'
const pad = (n: number) => String(n).padStart(2, '0')
const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

// The server takes deadlines up to 90 days out, so the month list covers this month and the next three.
function deadlineMonths(now = new Date()) {
  return Array.from({ length: 4 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    return { value: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, label: d.toLocaleString(undefined, { month: 'long', year: 'numeric' }) }
  })
}

const DEADLINE_TIMES = Array.from({ length: 48 }, (_, i) => {
  const value = `${pad(Math.floor(i / 2))}:${i % 2 ? '30' : '00'}`
  return { value, label: new Date(`2000-01-01T${value}`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) }
})

function tomorrow() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return { month: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, day: pad(d.getDate()) }
}

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
  paymentStatusError?: string | null
  walletEnabled?: boolean
  onCreateWallet?: () => Promise<unknown>
  onResetPin?: () => Promise<void>
  recipients?: PactMoneyRecipient[]
  onSend?: (toUserId: string, amount: string, requestId: string, onUpdate: (transfer: PactMoneyTransfer) => void) => Promise<PactMoneyTransfer>
  paymentRows?: PactPaymentStatusRow[] | null
  isHost?: boolean
  onCreateFundingPlan?: (input: { shareUsdc: string; deadline: string; payeeAddress: string }) => Promise<void>
  currentUserId?: string
  members?: PactMoneyMember[]
  onPactAction?: (action: PactAction) => Promise<string | null>
  onRetryVerification?: (eventType: PactVerificationError['eventType'], txHash: string) => Promise<void>
}

export function PactMoneyPanel({ pactName, memberCount = 0, status = 'unavailable', wallet = null, error = null, paymentStatusError = null, walletEnabled = false, onCreateWallet, onResetPin, recipients = [], onSend, paymentRows = null, isHost = false, onCreateFundingPlan, currentUserId, members = [], onPactAction, onRetryVerification }: Props) {
  const [shareUsdc, setShareUsdc] = useState('')
  const [deadlineMonth, setDeadlineMonth] = useState(() => tomorrow().month)
  const [deadlineDay, setDeadlineDay] = useState(() => tomorrow().day)
  const [deadlineTime, setDeadlineTime] = useState('19:00')
  const [payeeChoice, setPayeeChoice] = useState('')
  const [otherPayee, setOtherPayee] = useState('')
  const [planLoading, setPlanLoading] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  const hasWallet = Boolean(wallet)
  const [year, month] = deadlineMonth.split('-').map(Number)
  const daysInMonth = new Date(year, month, 0).getDate()
  const day = Math.min(Number(deadlineDay), daysInMonth)
  const deadline = `${deadlineMonth}-${pad(day)}T${deadlineTime}`
  const payeeOptions = [
    ...(wallet ? [{ address: wallet.address, label: `Me · ${shortAddress(wallet.address)}` }] : []),
    ...recipients.filter((r) => r.address).map((r) => ({ address: r.address!, label: `${r.name} · ${shortAddress(r.address!)}` })),
  ]
  const payeeValue = payeeChoice || payeeOptions[0]?.address || OTHER_PAYEE
  const payeeAddress = payeeValue === OTHER_PAYEE ? otherPayee.trim() : payeeValue
  const [toUserId, setToUserId] = useState('')
  const [amount, setAmount] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [transfer, setTransfer] = useState<PactMoneyTransfer | null>(null)
  // One requestId per send, kept across retries so a retry after an error reuses the same send on the server.
  // A new one only after that send finished, or when who or how much changes.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [acting, setActing] = useState<PactAction | null>(null)
  const [actionResult, setActionResult] = useState<{ ok: boolean; pending?: boolean; text: string; txHash?: string | null; eventType?: PactVerificationError['eventType'] } | null>(null)
  const [confirmingAction, setConfirmingAction] = useState<PactAction | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [resetting, setResetting] = useState(false)
  const [resetResult, setResetResult] = useState<{ ok: boolean; text: string } | null>(null)
  // A locked PIN can also block wallet setup, so the button shows then too.
  const canResetPin = Boolean(onResetPin) && (hasWallet || Boolean(error?.includes('Reset your PIN')))
  const recipientName = (userId: string) => recipients.find((r) => r.userId === userId)?.name ?? 'Pact member'

  // Deadline eligibility must change while the workspace remains open.
  // The server still makes the final authorization decision.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

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
    if ((action === 'release' || action === 'cancel') && confirmingAction !== action) {
      setConfirmingAction(action)
      return
    }
    setConfirmingAction(null)
    setActing(action); setActionResult(null)
    try {
      const txHash = await onPactAction(action)
      setActionResult({ ok: true, text: ACTION_DONE[action], txHash })
    } catch (reason) {
      const text = reason instanceof Error ? reason.message : 'That did not go through.'
      const verification = reason instanceof PactVerificationError
      setActionResult({ ok: false, pending: verification && reason.pending || /^Approved, but Arc has not confirmed/i.test(text), text, txHash: verification ? reason.txHash : null, eventType: verification ? reason.eventType : undefined })
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
  const verifiedReceipts = paymentRows?.filter((row) => row.tx_hash && (row.share_status === 'paid' || row.share_status === 'refunded')) || []
  const chainState = plan?.payment_status
  const iPaid = paymentRows?.some((row) => row.user_id === currentUserId && row.share_status === 'paid') || false
  const pastDeadline = plan ? Date.parse(plan.deadline) <= now : false
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
      {chainState === 'open' && paidCount < totalShares ? <span className="money-action-note">Waiting for {totalShares - paidCount} more of {totalShares} shares.</span> : null}
      {pastDeadline && chainState === 'open' ? <span className="money-action-note">Deadline passed. Anyone can cancel.</span> : null}
      {confirmingAction === 'release' ? <div className="money-action-confirm"><strong>You send {(Number(plan.share_usdc) * plan.shares_needed).toFixed(2)} USDC to {shortAddress(plan.payee_address)}.</strong><span>Confirm to continue to the Circle PIN screen.</span><button className="gold-button money-create-button" type="button" onClick={() => { void handlePactAction('release') }} disabled={Boolean(acting) || sending}>Confirm release</button><button className="outline-button" type="button" onClick={() => setConfirmingAction(null)} disabled={Boolean(acting)}>Back</button></div> : null}
      {confirmingAction === 'cancel' ? <div className="money-action-confirm"><strong>{pastDeadline ? 'Deadline passed. Anyone can cancel.' : 'Cancel this Pact before the deadline?'}</strong><span>{pastDeadline ? 'The deadline has passed, so any active member may request cancellation.' : 'Before the deadline, only the host can cancel. The backend will verify this rule.'}</span><button className="gold-button money-create-button" type="button" onClick={() => { void handlePactAction('cancel') }} disabled={Boolean(acting) || sending}>Confirm cancellation</button><button className="outline-button" type="button" onClick={() => setConfirmingAction(null)} disabled={Boolean(acting)}>Back</button></div> : null}
      {confirmingAction === null ? actions.map((action) => <button key={action} className={action === 'cancel' ? 'outline-button' : 'gold-button money-create-button'} type="button" onClick={() => { void handlePactAction(action) }} disabled={Boolean(acting) || sending}>{acting === action ? 'Waiting for Arc…' : ACTION_LABEL[action](plan.share_usdc)}</button>) : null}
      {actionResult ? <div className="money-action-result"><p className={actionResult.ok ? 'money-send-result is-confirmed' : actionResult.pending ? 'money-send-result' : 'form-error money-send-result'} role={actionResult.ok || actionResult.pending ? 'status' : 'alert'}>{actionResult.ok ? actionResult.text : actionResult.pending ? actionResult.text : `Verification failed: ${actionResult.text}`}{actionResult.txHash ? <> · <a href={ARC_EXPLORER + actionResult.txHash} target="_blank" rel="noreferrer">View on Arc explorer</a></> : null}</p>{actionResult.pending && actionResult.txHash && actionResult.eventType && onRetryVerification ? <button className="outline-button" type="button" disabled={Boolean(acting)} onClick={() => { const txHash = actionResult.txHash; const eventType = actionResult.eventType; if (!txHash || !eventType) return; setActing('pay_share'); void onRetryVerification(eventType, txHash).then(() => setActionResult({ ok: true, text: 'Payment Verified.', txHash, eventType })).catch((reason) => setActionResult({ ok: false, pending: true, text: reason instanceof Error ? reason.message : 'Pact is still checking this payment.', txHash, eventType })).finally(() => setActing(null)) }}>Retry PACT verification</button> : null}</div> : null}
      {actionResult && !actionResult.ok && /low_balance/i.test(actionResult.text) ? <a className="money-faucet-link" href="https://faucet.circle.com/" target="_blank" rel="noreferrer">Get Arc Testnet USDC from the faucet</a> : null}
    </div> : null}
    {plan && members.length ? <div className="money-member-list"><span className="money-label">MEMBER CONTRIBUTIONS</span>{members.map((member) => { const row = paymentRows?.find((item) => item.user_id === member.userId); const state = row?.share_status === 'paid' ? 'Paid' : row?.share_status === 'refunded' ? 'Refunded' : "Didn't pay"; return <div className="money-member-row" key={member.userId}><span>{member.name}</span><strong>{state}</strong>{state === 'Refunded' && row?.amount_usdc ? <small>Refunded {row.amount_usdc} USDC.</small> : state === "Didn't pay" ? <small>Nothing to refund.</small> : null}</div> })}</div> : null}
    {(!plan || chainState === 'none') && isHost && onCreateFundingPlan ? <form className="money-plan-form" onSubmit={(event) => { event.preventDefault(); setPlanLoading(true); setPlanError(null); void onCreateFundingPlan({ shareUsdc, deadline, payeeAddress }).catch((reason) => setPlanError(reason instanceof Error ? reason.message : 'Funding plan could not be created.')).finally(() => setPlanLoading(false)) }}><p className="money-label">{plan ? 'REPLACE FUNDING PLAN (until it is opened on chain)' : 'CREATE FUNDING PLAN'}</p><span className="money-label">SHARE PER PERSON (USDC)</span><input aria-label="Share amount in USDC" inputMode="decimal" placeholder="0.01" value={shareUsdc} onChange={(event) => setShareUsdc(event.target.value)} disabled={planLoading} required /><span className="money-label">DEADLINE</span><div className="money-plan-row"><select aria-label="Deadline month" value={deadlineMonth} onChange={(event) => setDeadlineMonth(event.target.value)} disabled={planLoading}>{deadlineMonths().map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select><select aria-label="Deadline day" value={pad(day)} onChange={(event) => setDeadlineDay(event.target.value)} disabled={planLoading}>{Array.from({ length: daysInMonth }, (_, i) => <option key={i} value={pad(i + 1)}>{i + 1}</option>)}</select><select aria-label="Deadline time" value={deadlineTime} onChange={(event) => setDeadlineTime(event.target.value)} disabled={planLoading}>{DEADLINE_TIMES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div><span className="money-label">PAID TO</span><select aria-label="Payee" value={payeeValue} onChange={(event) => setPayeeChoice(event.target.value)} disabled={planLoading}>{payeeOptions.map((o) => <option key={o.address} value={o.address}>{o.label}</option>)}<option value={OTHER_PAYEE}>Another wallet address…</option></select>{payeeValue === OTHER_PAYEE ? <input aria-label="Payee wallet address" placeholder="0x… wallet address" value={otherPayee} onChange={(event) => setOtherPayee(event.target.value)} disabled={planLoading} required /> : null}<button className="gold-button" type="submit" disabled={planLoading || !wallet}>{planLoading ? 'Saving plan…' : plan ? 'Replace funding plan' : 'Create funding plan'}</button>{!wallet ? <span>Connect the host wallet before configuring funding.</span> : null}{planError ? <p className="form-error" role="alert">{planError}</p> : null}</form> : null}
    <div className="money-sections"><div><p className="money-label">FUNDING GOAL</p><strong>{plan ? `${fundingGoal?.toFixed(2)} USDC` : 'Not configured'}</strong><span>{plan ? `Arc Testnet · ${plan.payment_status === 'none' ? 'not opened on chain yet' : plan.payment_status}` : 'No verified PactSplit funding target is available yet.'}</span></div><div><p className="money-label">MEMBER SHARES</p><strong>{plan ? `${plan.share_usdc} USDC each` : `${memberCount} eligible member${memberCount === 1 ? '' : 's'}`}</strong><span>{plan ? `${totalShares} share${totalShares === 1 ? '' : 's'} · ${paidCount} verified paid` : 'Share amounts will appear after the payment plan is created.'}</span></div><div><p className="money-label">PAYMENT STATUS</p><strong>{plan ? `${paidCount}/${totalShares} paid` : 'Awaiting verification'}</strong><span>{plan ? 'Only persisted verified payment events count.' : 'Wallet balance is not treated as contribution proof.'}</span></div><div><p className="money-label">RECEIPTS</p><strong>{plan && receiptCount ? `${receiptCount} available` : 'Unavailable'}</strong><span>{plan && receiptCount ? 'Transaction references are available for verified shares.' : 'Receipts require persisted, verified transaction events.'}</span></div></div>
    <div className="money-receipts"><div className="money-receipts-header"><div><p className="money-label">VERIFIED RECEIPTS</p><h3>Arc Testnet activity</h3></div><span>Blockchain confirmed only</span></div>{paymentStatusError ? <p className="form-error" role="alert">{paymentStatusError}</p> : paymentRows === null ? <p className="money-receipt-empty">Loading verified receipts…</p> : verifiedReceipts.length === 0 ? <p className="money-receipt-empty">No verified payment or refund receipts yet. Pending PIN activity will not appear here.</p> : <div className="money-receipt-list">{verifiedReceipts.map((row) => { const member = members.find((item) => item.userId === row.user_id); const isRefund = row.share_status === 'refunded'; const timestamp = isRefund ? row.refunded_at : row.paid_at; return <article className="money-receipt" key={`${row.share_id || row.payment_id}-${row.tx_hash}`}><div><strong>{member?.name || 'Pact member'}</strong><span>{isRefund ? 'Refund' : 'Payment'} · {row.amount_usdc ?? row.share_usdc} USDC</span></div><div><strong>Verified</strong><span>{timestamp ? new Date(timestamp).toLocaleString() : 'Timestamp unavailable'}</span></div><div><span>Arc Testnet</span>{row.tx_hash ? <a href={`${ARC_EXPLORER}${row.tx_hash}`} target="_blank" rel="noreferrer">View on ArcScan ↗</a> : null}</div></article> })}</div>}{plan?.payment_status === 'released' && !paymentRows?.some((row) => row.tx_hash && row.payment_status === 'released') ? <p className="money-receipt-note">The release is verified, but its lifecycle transaction receipt is not included in the current payment-status response.</p> : null}</div>
    <small className="money-note">{plan ? 'Funding data is read from the authorized Pact payment status service.' : 'PactSplit payment data is unavailable until the payment migration and verified event path are deployed.'}</small>
  </section>
}

