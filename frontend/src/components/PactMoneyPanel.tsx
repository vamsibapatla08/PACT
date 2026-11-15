import { useState, type FormEvent } from 'react'
import type { PactMoneyStatus, PactMoneyTransfer, PactMoneyWallet } from '../types/pactMoney'

export type PactMoneyRecipient = { userId: string; name: string }

const ARC_EXPLORER = 'https://explorer.testnet.arc.io/tx/'
const AMOUNT = /^\d+(\.\d{1,6})?$/
const TRANSFER_TEXT: Record<PactMoneyTransfer['status'], string> = { awaiting_pin: 'Waiting for your PIN…', pending: 'Sending on Arc…', confirmed: 'Sent', failed: 'Send failed' }

type Props = {
  pactName: string
  status?: PactMoneyStatus
  wallet?: PactMoneyWallet | null
  error?: string | null
  walletEnabled?: boolean
  onCreateWallet?: () => Promise<unknown>
  onResetPin?: () => Promise<void>
  recipients?: PactMoneyRecipient[]
  onSend?: (toUserId: string, amount: string, onUpdate: (transfer: PactMoneyTransfer) => void) => Promise<PactMoneyTransfer>
}

export function PactMoneyPanel({ pactName, status = 'unavailable', wallet = null, error = null, walletEnabled = false, onCreateWallet, onResetPin, recipients = [], onSend }: Props) {
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
    <div className="money-sections"><div><p className="money-label">SHARED EXPENSES</p><strong>No expenses recorded</strong><span>Expense tracking will appear when the payment backend is connected.</span></div><div><p className="money-label">MEMBER CONTRIBUTIONS</p><strong>Contributions unavailable</strong><span>Member balances require the confirmed wallet contract.</span></div><div><p className="money-label">PAYMENT STATUS</p><strong>Payments not connected</strong><span>No transfers or confirmations are being displayed.</span></div><div><p className="money-label">RECEIPTS</p><strong>No receipts yet</strong><span>Receipts will be available after transaction support is live.</span></div></div>
    <small className="money-note">Wallet creation and payment actions remain disabled until Rory’s user-controlled wallet contract is confirmed and deployed.</small>
  </section>
}

