import { useCallback, useEffect, useState } from 'react'
import * as S from './store'
import { Busy, Icon, Modal } from './ui'

/** The pact's live tab: who's up, who's down, the fewest paybacks to square up, and every expense. */
export function TabCard({ id, me, members, version }: { id: string; me: string; members: S.Member[]; version: number }) {
  const [tab, setTab] = useState<S.Tab | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const reload = useCallback(() => S.loadTab(id).then(setTab).catch((e: Error) => setError(e.message)), [id])
  // version changes when Grok edits the tab, so the change shows at once instead of on the next poll.
  useEffect(() => { void reload(); const t = setInterval(() => void reload(), 8000); return () => clearInterval(t) }, [reload, version])

  const run = async (label: string, work: () => Promise<unknown>) => {
    setWorking(label); setError(null)
    try { await work(); await reload() } catch (e) { setError((e as Error).message) }
    setWorking(null)
  }
  const who = (userId: string) => (userId === me ? 'You' : S.firstName(tab?.members.find((m) => m.user_id === userId)?.name))
  const mine = tab?.members.find((m) => m.user_id === me)
  const myBalance = mine?.balance_cents ?? 0

  return (
    <div className="l-about l-tab">
      <div className="l-section-title">Tab</div>
      <div className="l-tab-head">
        <b className={myBalance < 0 ? 'owe' : myBalance > 0 ? 'owed' : ''}>
          {!tab ? '…' : myBalance < 0 ? `You owe ${S.cents(myBalance)}` : myBalance > 0 ? `You're owed ${S.cents(myBalance)}` : "You're square"}
        </b>
        <button className="l-pill" type="button" onClick={() => setAdding(true)}><Icon name="plus" />I paid for something</button>
      </div>

      {tab && tab.settle_up.length > 0 && (
        <div className="l-list">
          {tab.settle_up.map((p) => (
            <div key={`${p.from}-${p.to}`} className="l-row">
              <div className="l-row-main"><b>{who(p.from)} → {who(p.to)}</b><span>{S.cents(p.amount_cents)} to square up</span></div>
              {p.from === me && <button className="l-btn l-small" type="button" disabled={Boolean(working)} onClick={() => void run('Sending…', () => S.payBack(id, p.to, p.amount_cents))}>Pay back</button>}
              {p.to === me && <button className="l-btn l-ghost l-small" type="button" disabled={Boolean(working)} onClick={() => { if (confirm(`Did ${who(p.from)} pay you ${S.cents(p.amount_cents)} in cash or another app?`)) void run('Saving…', () => S.gotPaidBack(id, p.from, p.amount_cents)) }}>Got paid in cash</button>}
            </div>
          ))}
        </div>
      )}

      {tab && tab.expenses.length > 0 && (
        <div className="l-list">
          {tab.expenses.map((e) => {
            const payers = Object.keys(e.payers)
            const myPart = e.shares[me] ?? 0
            const canEdit = e.created_by === me || payers.includes(me)
            return (
              <div key={e.expense_id} className="l-row">
                <div className="l-row-main">
                  <b>{e.title} · {S.cents(e.total_cents)}</b>
                  <span>{payers.map(who).join(' & ')} paid · split {Object.keys(e.shares).length} ways{myPart ? ` · your part ${S.cents(myPart)}` : ''}{e.source === 'wallet' ? ' · from the wallet' : e.source === 'plan' ? ' · the booking' : ''}</span>
                </div>
                {!(me in e.shares) && <button className="l-btn l-ghost l-small" type="button" disabled={Boolean(working)} onClick={() => void run('Joining…', () => S.joinExpense(e.expense_id))}>I'm in too</button>}
                {canEdit && <button className="l-remove" type="button" disabled={Boolean(working)} onClick={() => { if (confirm(`Remove ${e.title} from the tab?`)) void run('Removing…', () => S.voidExpense(e.expense_id)) }}>Remove</button>}
              </div>
            )
          })}
        </div>
      )}
      {tab && !tab.expenses.length && <p className="l-dim">Nothing on the tab yet. When someone pays for the group, add it here and it splits itself.</p>}

      {working && <Busy text={working} />}
      {error && <p className="l-error">{error}</p>}
      {adding && <AddExpense id={id} me={me} members={members} onClose={() => setAdding(false)} onDone={() => { setAdding(false); void reload() }} />}
    </div>
  )
}

/** "I paid for something": what, how much, who paid and who it's for. Even split, cents handled by the database. */
export function AddExpense({ id, me, members, txHash, amountCents, onClose, onDone }: {
  id: string; me: string; members: S.Member[]; txHash?: string; amountCents?: number; onClose: () => void; onDone: () => void
}) {
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState(amountCents ? (amountCents / 100).toFixed(2) : '')
  const [paidBy, setPaidBy] = useState(me)
  const [forWho, setForWho] = useState<string[]>(members.map((m) => m.user_id))
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const total = S.toCents(amount)
  const each = forWho.length ? Math.floor(total / forWho.length) : 0
  const toggle = (u: string) => setForWho((all) => (all.includes(u) ? all.filter((x) => x !== u) : [...all, u]))
  return (
    <Modal title={txHash ? 'Split this payment' : 'I paid for something'} onClose={onClose}>
      <form className="l-form" onSubmit={async (e) => {
        e.preventDefault(); setWorking(true); setError(null)
        try { await S.addExpense(id, { title, totalCents: total, paidBy, splitWith: forWho, txHash }); onDone() }
        catch (err) { setError((err as Error).message); setWorking(false) }
      }}>
        <label className="l-field"><span>What</span><input className="l-input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Coffee, Uber, groceries…" maxLength={120} /></label>
        <label className="l-field"><span>How much</span><input className="l-input" inputMode="decimal" value={amount} disabled={Boolean(txHash)} onChange={(e) => setAmount(e.target.value)} placeholder="$" /></label>
        {!txHash && (
          <label className="l-field"><span>Who paid</span>
            <select className="l-input" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.user_id === me ? 'You' : m.name ?? 'Someone'}</option>)}
            </select>
          </label>
        )}
        <div className="l-field"><span>Split with</span>
          <div className="l-kinds">{members.map((m) => (
            <button key={m.user_id} type="button" className={forWho.includes(m.user_id) ? 'on' : ''} onClick={() => toggle(m.user_id)}>{m.user_id === me ? 'You' : S.firstName(m.name)}</button>
          ))}</div>
        </div>
        {total > 0 && forWho.length > 0 && <p className="l-dim">About {S.cents(each)} each</p>}
        {error && <p className="l-error">{error}</p>}
        <button className="l-btn l-wide-btn" type="submit" disabled={working || !title.trim() || total <= 0 || !forWho.length}>{working ? 'Adding…' : 'Add to the tab'}</button>
      </form>
    </Modal>
  )
}
