import { useState } from 'react'
import * as S from './store'
import { Busy, Grok } from './ui'

/** Ask Grok for anything in the pact. Its changes show as one approve card and run only when you approve. */
export function PilotCard({ id, me, members, onDone }: { id: string; me: string; members: S.Member[]; onDone: () => void }) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<S.PilotAnswer | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (label: string, work: () => Promise<unknown>) => {
    setWorking(label); setError(null)
    try { await work() } catch (e) { setError((e as Error).message) }
    setWorking(null)
  }
  return (
    <div className="l-about l-pilot">
      <div className="l-section-title">Ask Grok</div>
      <form className="l-tab-ask" onSubmit={(e) => { e.preventDefault(); if (question.trim()) void run('Grok is reading the pact…', async () => { setAnswer(await S.askGrok(id, question)); setQuestion('') }) }}>
        <span className="l-av" style={{ width: 26, height: 26, background: '#000' }}><Grok size={15} /></span>
        <input className="l-input" value={question} onChange={(e) => setQuestion(e.target.value)} disabled={Boolean(working)} maxLength={600}
          placeholder="“I got coffee for everyone, $18” · “Start a vote on Friday or Saturday” · “Can I crash at the hotel too?”" />
      </form>

      {answer && <PilotAnswerView id={id} me={me} members={members} answer={answer} onDone={() => { setAnswer(null); onDone() }} onDismiss={() => setAnswer(null)} />}
      {working && <Busy text={working} />}
      {error && <p className="l-error">{error}</p>}
    </div>
  )
}

/** Grok's reply, and any changes it wants to make as one card you approve. Used by the Ask Grok card and by @Grok in the chat. */
export function PilotAnswerView({ id, me, members, answer, onDone, onDismiss }: {
  id: string; me: string; members: S.Member[]; answer: S.PilotAnswer; onDone: () => void; onDismiss: () => void
}) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const who = (userId: string) => (userId === me ? 'you' : S.firstName(members.find((m) => m.user_id === userId)?.name))
  const changes = answer.actions.filter((a) => !a.tool.startsWith('read_'))
  return (
    <div className="l-tab-answer">
      <p>{answer.reply}</p>
      {changes.length > 0 && (
        <div className="l-pilot-plan">
          <span className="l-dim">Grok wants to</span>
          <ul>{changes.map((a, i) => <li key={i}>{label(a, who)}</li>)}</ul>
          {answer.operationId ? (
            <div className="l-pilot-buttons">
              <button className="l-btn l-small" type="button" disabled={working}
                onClick={async () => { setWorking(true); setError(null); try { await S.approveGrok(id, answer.operationId!); onDone() } catch (e) { setError((e as Error).message) } setWorking(false) }}>
                {working ? 'Making the changes…' : 'Approve'}
              </button>
              <button className="l-btn l-ghost l-small" type="button" disabled={working} onClick={onDismiss}>Not now</button>
            </div>
          ) : <p className="l-error">Grok's plan wasn't saved, so it can't run. Ask again.</p>}
        </div>
      )}
      {error && <p className="l-error">{error}</p>}
    </div>
  )
}

/** One line per change, in plain words. */
function label(a: S.PilotAction, who: (id: string) => string) {
  const args = a.args
  const money = (c: unknown) => S.cents(Number(c) || 0)
  const people = (ids: unknown) => (Array.isArray(ids) ? ids.map((u) => who(String(u))).join(', ') : 'everyone')
  switch (a.tool) {
    case 'add_expense': return `Add ${String(args.title ?? 'it')} · ${money(args.total_cents)} to the tab, split with ${people(args.split_with)}`
    case 'join_expense': return args.booking ? 'Add you to the booking on the tab' : 'Add you to that expense'
    case 'resplit_expense': return `Re-split it with ${people(args.split_with)}`
    case 'import_plan_to_tab': return 'Put the booking on the tab'
    case 'create_poll': return `Start a vote: ${String(args.question ?? '')}${Array.isArray(args.options) ? ` (${args.options.join(' / ')})` : ''}`
    case 'prepare_booking_proposal': return 'Put a booking up for the group to approve'
    case 'prepare_split': return 'Set up how the booking is split'
    case 'prepare_rebalance': return 'Propose a new split'
    case 'vote_rebalance': return `Vote ${String(args.vote ?? '')} on the new split`
    case 'apply_rebalance': return 'Apply the new split'
    case 'publish_action_card': return `Post a card: ${String(args.title ?? '')}`
    case 'enqueue_email': return 'Email everyone the details'
    default: return a.tool.replaceAll('_', ' ')
  }
}
