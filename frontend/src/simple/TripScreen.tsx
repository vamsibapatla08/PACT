import { useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { createPactInvitation, friendlyError } from '../lib/pactService'
import { sendPactMessage, subscribeToPactMessages } from '../lib/chatService'
import { askPactPilot } from '../lib/pactPilotService'
import { castPactDecisionVote, createPactDecision, savePactRecommendation } from '../lib/pactFlowService'
import { createPactFundingPlan, createPactMoneyWallet, getPactMoneyWalletStatus, PactVerificationError, runPactAction, type PactAction } from '../lib/pactMoneyService'
import type { PactRecommendation } from '../types/pactFlow'
import type { PactPilotOption } from '../types/pactPilot'
import { Avatar, Header, type Go } from './SimpleApp'
import { approvedDecision, loadTrip, memberName, money, nextStep, optionsOf, pickedOption, stageOf, stages, voteQuestion, type Trip, type TripDecision, type Vote } from './trip'

const STAGE_LABEL = { plan: 'Plan', vote: 'Vote', pay: 'Pay', booked: 'Booked' } as const
const ASK_GROK = 'Sum up what we agreed in the chat, and suggest 3 places to stay with a price per person.'

export function TripScreen({ id, user, go }: { id: string; user: User; go: Go }) {
  const [trip, setTrip] = useState<Trip | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [invite, setInvite] = useState<string | null>(null)
  const fresh = new URLSearchParams(window.location.search).has('invite')

  const refresh = () => loadTrip(id, user.id).then(setTrip)
  useEffect(() => {
    let live = true
    loadTrip(id, user.id).then((t) => { if (live) setTrip(t) }).catch((reason) => { if (live) setError(friendlyError(reason, 'This trip could not be opened.')) })
    // Votes and payments land from other people, so the trip re-reads itself while it's open.
    const timer = setInterval(() => { loadTrip(id, user.id).then((t) => { if (live) setTrip(t) }).catch(() => {}) }, 6000)
    const stop = subscribeToPactMessages(id, (message) => {
      if (live) setTrip((t) => t && !t.messages.some((m) => m.id === message.id) ? { ...t, messages: [...t.messages, message] } : t)
    }, () => {})
    return () => { live = false; clearInterval(timer); stop() }
  }, [id, user.id])

  // One action at a time; its label shows on the button while it runs, and any failure lands in the notice.
  async function run(label: string, work: () => Promise<unknown>) {
    setBusy(label); setNotice(null)
    try { await work(); await refresh() }
    catch (reason) {
      if (reason instanceof PactVerificationError) { setNotice('Done. It went through on chain and Pact is still confirming it.'); await refresh() }
      else setNotice(reason instanceof Error ? reason.message : 'That didn’t go through. Try again.')
    }
    finally { setBusy(null) }
  }

  async function walletAddress() {
    const existing = await getPactMoneyWalletStatus()
    if (existing) return existing.address
    setBusy('Set your PIN…')
    return (await createPactMoneyWallet()).address
  }
  const chain = (action: PactAction, label: string) => run(label, async () => { await walletAddress(); setBusy('Confirming…'); await runPactAction(action, id) })

  async function makeInvite() {
    const code = await createPactInvitation(id)
    const link = `${window.location.origin}/pacts/join?invite=${encodeURIComponent(code)}`
    setInvite(link)
    await navigator.clipboard?.writeText(link).catch(() => {})
  }

  if (error) return <><Header title="Trip" back="/dashboard" go={go} /><p className="s-error" role="alert">{error}</p></>
  if (!trip) return <><Header title="Loading…" back="/dashboard" go={go} /><p className="s-mute">Opening the trip…</p></>

  const stage = stageOf(trip)
  const step = nextStep(trip)
  const approved = approvedDecision(trip)
  const picked = approved ? pickedOption(trip, approved) : null

  return (
    <>
      <Header title={trip.pact.name} back="/dashboard" go={go} right={
        <div className="s-stack">{trip.pact.members.slice(0, 5).map((m) => <Avatar key={m.user_id} name={m.profile?.full_name} url={m.profile?.avatar_url} size={30} />)}</div>
      } />

      <ol className="s-steps" aria-label="Where the trip is up to">
        {stages.map((s, i) => {
          const done = stages.indexOf(stage) > i || (s === 'booked' && stage === 'booked')
          return <li key={s} className={s === stage && s !== 'booked' ? 'now' : done ? 'done' : ''}>{STAGE_LABEL[s]}{done ? ' ✓' : ''}</li>
        })}
      </ol>

      {(fresh || trip.pact.members.length < 2 || invite) && stage !== 'booked' && (
        <section className="s-card">
          <span className="s-lab">Invite your group</span>
          {invite ? <><code className="s-link">{invite}</code><span className="s-mute">Copied. Paste it in your group chat. It works for 24 hours.</span></>
            : <div className="s-row s-between"><span>{trip.pact.members.length} going so far</span><button className="s-btn s-ghost" type="button" onClick={() => void run('Making link…', makeInvite)} disabled={Boolean(busy)}>Copy invite link</button></div>}
        </section>
      )}

      <section className="s-card s-card-gold" aria-live="polite">
        <span className="s-lab">Your next step</span>
        <NextStepBody trip={trip} step={step} busy={busy} run={run} chain={chain} walletAddress={walletAddress} />
        {notice && <p className="s-notice">{notice}</p>}
      </section>

      {picked && approved && (
        <section className="s-card">
          <span className="s-lab">The group picked</span>
          <div className="s-row s-between"><b>{picked.title}</b>{picked.price_per_person != null && <span className="s-num">${money(picked.price_per_person)} each</span>}</div>
          <span className="s-mute">{picked.description}</span>
        </section>
      )}

      {trip.payment && <Pot trip={trip} />}

      <Chat trip={trip} busy={busy} run={run} id={id} />
    </>
  )
}

type Run = (label: string, work: () => Promise<unknown>) => Promise<void>

function NextStepBody({ trip, step, busy, run, chain, walletAddress }: { trip: Trip; step: ReturnType<typeof nextStep>; busy: string | null; run: Run; chain: (a: PactAction, l: string) => Promise<void>; walletAddress: () => Promise<string> }) {
  const disabled = Boolean(busy)
  const button = (label: string, onClick: () => void) => <button className="s-btn" type="button" onClick={onClick} disabled={disabled}>{busy ?? label}</button>
  switch (step.kind) {
    case 'ask':
      return <div className="s-next"><span>Talk it through below, then let Grok sum up what you agreed and find places to stay.</span>{button('Ask Grok', () => void run('Grok is reading…', () => ask(trip, ASK_GROK)))}</div>
    case 'pick':
      return <div className="s-next"><span>Grok found some options. Put the one you like to a vote in the chat.</span><a className="s-btn s-ghost" href="#chat">See options</a></div>
    case 'vote': {
      const option = pickedOption(trip, step.decision)
      return <div className="s-next"><span>{step.decision.question}{option?.price_per_person != null ? ` $${money(option.price_per_person)} each.` : ''}</span><div className="s-row">{button('Yes', () => void run('Voting…', () => castPactDecisionVote(step.decision.decision_id, 'approve')))}<button className="s-btn s-ghost" type="button" disabled={disabled} onClick={() => void run('Voting…', () => castPactDecisionVote(step.decision.decision_id, 'reject'))}>No</button></div></div>
    }
    case 'set-share':
      return <SetShare trip={trip} price={step.price} busy={busy} run={run} walletAddress={walletAddress} />
    case 'open-pot':
      return <div className="s-next"><span>Shares are set. Open the pot so everyone can pay. You’ll confirm with your PIN.</span>{button('Open the pot', () => void chain('create_pact', 'Enter your PIN…'))}</div>
    case 'pay':
      return (
        <div className="s-pay">
          <div className="s-row s-between"><b className="s-big">${money(step.amount)}</b>{button(`Pay $${money(step.amount)}`, () => void chain('pay_share', 'Enter your PIN…'))}</div>
          <span className="s-mute">Held in the trip until everyone has paid{trip.payment ? `, due ${new Date(trip.payment.deadline).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}` : ''}. You get it back if the trip falls through.</span>
        </div>
      )
    case 'release':
      return <div className="s-next"><span>Everyone’s in. Send the ${money(step.total)} to you so you can book it.</span>{button(`Send $${money(step.total)}`, () => void chain('release', 'Enter your PIN…'))}</div>
    case 'wait':
      return <div className="s-next"><span>{step.text}</span></div>
    case 'done':
      return <div className="s-next"><b>{step.text}</b></div>
  }
}

async function ask(trip: Trip, question: string) {
  const answer = await askPactPilot({ context: { pactId: trip.pact.id, pactName: trip.pact.name }, prompt: question })
  await savePactRecommendation(trip.pact.id, { summary: answer.summary || answer.body, options: answer.options, tasks: answer.tasks, costs: answer.costs, next_steps: answer.next_steps })
}

function SetShare({ trip, price, busy, run, walletAddress }: { trip: Trip; price: number | null; busy: string | null; run: Run; walletAddress: () => Promise<string> }) {
  const week = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)
  const [share, setShare] = useState(price != null ? money(price) : '')
  const [due, setDue] = useState(week)
  const people = trip.pact.members.length
  const valid = Number(share) > 0
  function save() {
    void run('Saving…', async () => {
      const payee = await walletAddress()
      await createPactFundingPlan({ pactId: trip.pact.id, shareUsdc: share, deadline: new Date(`${due}T19:00`).toISOString(), payeeAddress: payee })
    })
  }
  return (
    <form className="s-share" onSubmit={(e) => { e.preventDefault(); if (valid) save() }}>
      <span>The group picked it. Set what each person pays. It all comes to you to book.</span>
      <div className="s-grid2">
        <label htmlFor="share-amount">Each pays ($)<input id="share-amount" inputMode="decimal" value={share} onChange={(e) => setShare(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
        <label htmlFor="share-due">Pay by<input id="share-due" type="date" value={due} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDue(e.target.value)} /></label>
      </div>
      <span className="s-mute">{people} people × ${share || '0'} = ${valid ? money(Number(share) * people) : '0'}</span>
      <button className="s-btn" type="submit" disabled={Boolean(busy) || !valid}>{busy ?? 'Set shares'}</button>
    </form>
  )
}

function Pot({ trip }: { trip: Trip }) {
  const p = trip.payment!
  const paid = p.shares.filter((s) => s.paid).length
  const total = p.share * p.needed
  return (
    <section className="s-card">
      <div className="s-row s-between"><span className="s-lab">The pot</span><span className="s-num"><b>${money(p.share * paid)}</b> of ${money(total)}</span></div>
      <div className="s-track"><span style={{ width: `${Math.max(3, (paid / Math.max(1, p.needed)) * 100)}%` }} /></div>
      <ul className="s-people">
        {trip.pact.members.map((m) => {
          const share = p.shares.find((s) => s.userId === m.user_id)
          return (
            <li key={m.user_id}>
              <Avatar name={m.profile?.full_name} url={m.profile?.avatar_url} size={28} />
              <span>{memberName(trip, m.user_id)}</span>
              {!share ? <span className="s-pill mute">No share</span>
                : share.refunded ? <span className="s-pill mute">Refunded</span>
                : share.paid ? (share.txHash ? <a className="s-pill ok" href={`https://explorer.testnet.arc.io/tx/${share.txHash}`} target="_blank" rel="noreferrer">Paid · confirmed ↗</a> : <span className="s-pill ok">Paid · confirmed</span>)
                : <span className="s-pill gold">Not yet</span>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

type Item =
  | { kind: 'msg'; at: string; id: string; sender: string; body: string }
  | { kind: 'grok'; at: string; id: string; rec: PactRecommendation }
  | { kind: 'vote'; at: string; id: string; decision: TripDecision }

function Chat({ trip, busy, run, id }: { trip: Trip; busy: string | null; run: Run; id: string }) {
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const items: Item[] = [
    ...trip.messages.map((m) => ({ kind: 'msg' as const, at: m.created_at, id: m.id, sender: m.sender_id, body: m.body })),
    ...trip.recommendations.map((r) => ({ kind: 'grok' as const, at: r.created_at, id: r.recommendation_id, rec: r })),
    ...trip.decisions.map((d) => ({ kind: 'vote' as const, at: d.created_at, id: d.decision_id, decision: d })),
  ].sort((a, b) => a.at.localeCompare(b.at))
  useEffect(() => { if (window.location.hash === '#chat') end.current?.scrollIntoView({ block: 'end' }) }, [items.length])

  const send = () => { const body = text.trim(); if (!body) return; setText(''); void sendPactMessage(id, body).catch(() => setText(body)) }
  const propose = (rec: PactRecommendation, option: PactPilotOption) => run('Starting the vote…', () => createPactDecision(id, voteQuestion(option), ['Yes', 'No'], 'majority', rec.recommendation_id))
  const vote = (d: TripDecision, v: Vote) => run('Voting…', () => castPactDecisionVote(d.decision_id, v))
  const locked = trip.decisions.some((d) => d.status !== 'rejected') || Boolean(trip.payment)

  return (
    <section className="s-chat" id="chat">
      <h2 className="s-h2">Group chat</h2>
      {!items.length && <div className="s-empty"><b>Say hi to the group</b><span>Talk about dates, budget and where to stay. Grok reads it.</span></div>}
      <div className="s-thread">
        {items.map((item) => {
          if (item.kind === 'msg') {
            const mine = item.sender === trip.me
            return <div key={item.id} className={mine ? 's-bubble me' : 's-bubble'}>{!mine && <small>{memberName(trip, item.sender)}</small>}{item.body}</div>
          }
          if (item.kind === 'grok') return (
            <div key={item.id} className="s-grok">
              <span className="s-grok-head">✦ Grok</span>
              <p>{item.rec.summary}</p>
              {optionsOf(item.rec).map((o) => (
                <div key={o.title} className="s-option">
                  <div className="s-row s-between"><b>{o.title}</b>{o.price_per_person != null && <span className="s-num">${money(o.price_per_person)} each</span>}</div>
                  <span className="s-mute">{o.description}</span>
                  {o.tradeoff && <span className="s-mute">Catch: {o.tradeoff}</span>}
                  <div className="s-row">
                    {!locked && <button className="s-btn s-small" type="button" disabled={Boolean(busy)} onClick={() => void propose(item.rec, o)}>Put to a vote</button>}
                    {o.link && <a className="s-btn s-ghost s-small" href={o.link} target="_blank" rel="noreferrer">Look ↗</a>}
                  </div>
                </div>
              ))}
            </div>
          )
          const d = item.decision
          return (
            <div key={item.id} className={`s-votecard ${d.status}`}>
              <div className="s-row s-between"><b>{d.question}</b><span className={`s-pill ${d.status === 'approved' ? 'ok' : d.status === 'rejected' ? 'mute' : 'gold'}`}>{d.status === 'approved' ? 'Picked' : d.status === 'rejected' ? 'Not this one' : `${d.approve_count ?? 0} of ${d.eligible_count ?? trip.pact.members.length} yes`}</span></div>
              {d.status === 'open' && !d.myVote && <div className="s-row"><button className="s-btn s-small" type="button" disabled={Boolean(busy)} onClick={() => void vote(d, 'approve')}>Yes</button><button className="s-btn s-ghost s-small" type="button" disabled={Boolean(busy)} onClick={() => void vote(d, 'reject')}>No</button></div>}
              {d.myVote && <span className="s-mute">You voted {d.myVote === 'approve' ? 'yes' : 'no'}.</span>}
            </div>
          )
        })}
        <div ref={end} />
      </div>
      <form className="s-compose" onSubmit={(e) => { e.preventDefault(); send() }}>
        <input id="chat-message" value={text} onChange={(e) => setText(e.target.value)} placeholder="Message the group" aria-label="Message the group" />
        <button className="s-btn" type="submit" disabled={!text.trim()}>Send</button>
      </form>
      <button className="s-grok-ask" type="button" disabled={Boolean(busy)} onClick={() => void run('Grok is reading…', () => ask(trip, ASK_GROK))}>✦ {busy === 'Grok is reading…' ? 'Grok is reading the chat…' : 'Ask Grok to sum up and find stays'}</button>
    </section>
  )
}
