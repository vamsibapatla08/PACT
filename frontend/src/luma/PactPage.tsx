import { useCallback, useEffect, useRef, useState } from 'react'
import * as S from './store'
import { DetailsForm, useApp } from './App'
import { Avatar, Busy, Cover, Grok, Icon, Modal, Switch, VerifiedBadge } from './ui'
import { TabCard } from './TabCard'
import { PilotCard } from './PilotCard'

type Sheet =
  | { kind: 'settings' } | { kind: 'addPeople' } | { kind: 'addItem' } | { kind: 'grok' }
  | { kind: 'summary'; rec: S.Recommendation } | { kind: 'booking'; booking: S.Booking }
  | { kind: 'action'; action: 'create_pact' | 'pay_share' | 'release' } | { kind: 'person'; member: S.Member }

export function PactPage({ id }: { id: string }) {
  const app = useApp()
  const { me, pacts, data, wallet, refreshPact, go } = app
  const pact = pacts?.find((p) => p.pact_id === id)
  const d = data[id]
  const [messages, setMessages] = useState<S.Message[]>([])
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tabVersion, setTabVersion] = useState(0)
  const chatRef = useRef<HTMLElement>(null)
  /** What Grok is doing right now, shown at the bottom of the chat: thinking, slow, or failed with a retry. */
  const [grokJob, setGrokJob] = useState<{ label: string; slow: boolean; error: string | null; retry: () => void } | null>(null)

  // Chat arrives live; the plan and the split refresh every 6 seconds, like the iOS chat.
  useEffect(() => {
    void S.loadMessages(id).then(setMessages)
    const channel = S.supabase.channel(`pact-messages:${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pact_messages', filter: `pact_id=eq.${id}` }, (payload) => {
        const m = payload.new as S.Message
        setMessages((all) => (all.some((x) => x.message_id === m.message_id) ? all : [...all, m]))
      }).subscribe()
    const timer = setInterval(() => void refreshPact(id), 6000)
    void refreshPact(id)
    return () => { clearInterval(timer); void S.supabase.removeChannel(channel) }
  }, [id, refreshPact])

  const name = useCallback((userId: string) => {
    if (userId === me) return 'You'
    return d?.members.find((m) => m.user_id === userId)?.name ?? app.name(userId)
  }, [d, me, app])

  const run = useCallback(async (label: string, work: () => Promise<unknown>) => {
    setWorking(label); setError(null)
    S.setGrokRetryListener(() => setWorking('Grok is taking longer than usual…'))
    try { await work(); await refreshPact(id) }
    catch (e) { setError((e as Error).message || 'That didn’t go through.') }
    setWorking(null)
  }, [id, refreshPact])

  const runGrok = useCallback(async (label: string, work: () => Promise<unknown>) => {
    const again = () => void runGrok(label, work)
    setGrokJob({ label, slow: false, error: null, retry: again })
    S.setGrokRetryListener(() => setGrokJob((j) => (j ? { ...j, slow: true } : j)))
    chatRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    try { await work(); await refreshPact(id); setGrokJob(null) }
    catch (e) { setGrokJob({ label, slow: false, error: (e as Error).message || "Grok couldn't answer. Try again.", retry: again }) }
    finally { S.setGrokRetryListener(null) }
  }, [id, refreshPact])

  const step = d ? S.step(d, me, Boolean(wallet)) : null

  // Once everyone approves, the coordinator's page saves the split on its own.
  const settingUp = useRef(false)
  useEffect(() => {
    if (step?.kind !== 'settingUp' || !wallet || !d || settingUp.current) return
    settingUp.current = true
    void run('Setting up the split…', () => S.setUpSplit(id, d, wallet)).finally(() => { settingUp.current = false })
  }, [step?.kind, wallet, d, id, run])

  if (!pacts) return <div className="l-center"><span className="l-spin" /></div>
  if (!pact) return <main className="l-page"><div className="l-card l-empty"><b>This pact isn't here</b><span>You may not be in it any more.</span><div><button className="l-btn l-ghost" type="button" onClick={() => go('/pacts')}>Back to pacts</button></div></div></main>

  const details = S.detailsOf(pact)
  const host = d && S.coordinator(d)
  const iCoordinate = host?.user_id === me
  const b = d && S.booking(d)
  const latest = d?.recommendations[0] ?? null
  const hasGrok = Boolean(latest)
  const finished = step?.kind === 'done' || step?.kind === 'cancelled'
  const proof = d ? S.verification(d) : null
  const askBook = (): Promise<unknown> => (d?.items.length ? S.bookItems(id, pact, d.items, me) : S.askGrokToBook(id, me, pact, messages, name))

  function doStep() {
    if (!step || !d) return
    switch (step.kind) {
      case 'talk': case 'declined': return void runGrok('Grok is reading the chat to write up what to book…', askBook)
      case 'approve': return void run(wallet ? 'Approving…' : 'Set your PIN…', async () => { await S.approve(step.decision, wallet); if (!wallet) app.setWallet(await S.loadWallet()) })
      case 'needsWallet': return void run('Set your PIN…', async () => app.setWallet(await S.makeWallet()))
      case 'startCollecting': return setSheet({ kind: 'action', action: 'create_pact' })
      case 'pay': return setSheet({ kind: 'action', action: 'pay_share' })
      case 'finalise': return setSheet({ kind: 'action', action: 'release' })
    }
  }

  return (
    <main className="l-page l-wide">
      <div className="l-event-page">
        <aside className="l-side">
          <Cover kind={details.kind} name={pact.name} sub={pact.location} big />
          {host && (
            <div className="l-coord">
              <button type="button" className="l-coord-who" onClick={() => setSheet({ kind: 'person', member: host })}>
                <Avatar name={host.name} url={host.avatar_url} size={44} />
                <b>{host.user_id === me ? 'You' : host.name ?? 'Someone'}</b>
              </button>
              <span className="l-coord-role"><Icon name="crown" size={13} />Coordinator</span>
              <button className="l-icon-btn" type="button" onClick={() => setSheet({ kind: 'settings' })} aria-label="Pact settings" title="Settings"><Icon name="gear" /></button>
            </div>
          )}
          <div>
            <div className="l-section-title">Going</div>
            {d?.members.filter((m) => m.role !== 'host').map((m) => (
              <div key={m.user_id} className="l-person">
                <button type="button" className="l-person-open" onClick={() => setSheet({ kind: 'person', member: m })}>
                  <Avatar name={m.name} url={m.avatar_url} size={30} /><b>{m.user_id === me ? 'You' : m.name ?? 'Someone'}</b>
                </button>
                {iCoordinate && m.user_id !== me && !d.plan
                  ? <button className="l-remove" type="button" disabled={Boolean(working)} onClick={() => { if (confirm(`Remove ${S.firstName(m.name)} from this pact?`)) void run('Removing…', () => S.removeMember(id, m.user_id)) }}>Remove</button>
                  : <small>Member</small>}
              </div>
            ))}
            {d?.joinRequests.map((r) => (
              <div key={r.user_id} className="l-person pending"><Avatar name={r.name} url={r.avatar_url} size={26} /><b>{r.name ?? 'Someone'}</b><small>Pending</small></div>
            ))}
            <button type="button" className="l-person" onClick={() => setSheet({ kind: 'grok' })}>
              <span className="l-av" style={{ width: 26, height: 26, background: '#000' }}><Grok size={15} /></span><b>Grok</b><small>Planner</small>
            </button>
          </div>
          <div className="l-side-actions">
            <button className="l-btn" type="button" onClick={() => setSheet({ kind: 'addPeople' })}><Icon name="plus" size={17} />Add people</button>
            <button className="l-btn l-ghost" type="button" onClick={() => go('/pacts')}><Icon name="pacts" size={17} />All pacts</button>
          </div>
          <p className="l-side-note">Anyone in the pact can add people. Only the coordinator can remove them{d?.plan ? ', and not once the split is set up' : ''}.</p>
        </aside>

        <section>
          {proof && proof.level !== 'none' && <div><VerifiedBadge level={proof.level} compact /></div>}
          <h1 className="l-title">{pact.name}</h1>
          <DateFact pact={pact} />
          <div className="l-fact">
            <div className="l-fact-icon"><Icon name="pin" /></div>
            <div><b>{pact.location || 'Where to be decided'}</b><span>{details.budget != null ? `Budget ${S.dollars(details.budget)} each` : 'No budget set'}</span></div>
          </div>

          {step && <Progress step={step} />}
          {finished && d && proof ? <BookedCard step={step!} d={d} proof={proof} me={me} name={name} />
            : step && <StepCard step={step} hasGrok={hasGrok} working={working} onAct={doStep}
            onDecline={step.kind === 'approve' ? () => void run('Saying not yet…', () => S.vote(step.decision, false)) : undefined}
            chain={d.chain} members={d.members} me={me} />}
          {error && <p className="l-error">{error}</p>}

          {!finished && <><div className="l-actions-row">
            <div className="l-actions">
            <button className="l-pill" type="button" onClick={() => setSheet({ kind: 'addItem' })}><Icon name="plus" />Add item</button>
            <button className="l-pill" type="button" disabled={Boolean(grokJob && !grokJob.error)} onClick={() => void runGrok('Grok is summing up the chat…', () => S.askPilot(id, S.summaryQuestion, messages, name))}><Icon name="text" />Summary</button>
            </div>
            {(step?.kind === 'talk' || step?.kind === 'declined') && <button className="l-book" type="button" disabled={Boolean(grokJob && !grokJob.error)} onClick={() => void runGrok(d?.items.length ? 'Putting your items up to approve…' : 'Grok is reading the chat to write up what to book…', askBook)}><Icon name="sparkles" />Book it</button>}
          </div>

          </>}

          {(details.about || pact.link || d?.items.length) ? (
            <div className="l-about">
              <div className="l-section-title">About</div>
              {details.about && <p>{details.about}</p>}
              {pact.link && <div className="l-kv"><span>Link</span><a href={pact.link} target="_blank" rel="noreferrer">{pact.link.replace(/^https?:\/\//, '')}</a></div>}
              {d && d.items.length > 0 && <Items items={d.items} />}
            </div>
          ) : null}

          {d && <PilotCard id={id} me={me} members={d.members} onDone={() => { setTabVersion((v) => v + 1); void refreshPact(id) }} />}
          {d && <TabCard id={id} me={me} members={d.members} version={tabVersion} />}

        </section>
      </div>

      {/* Scroll down into the chat: one wide, simple conversation with Grok's write-ups in it. */}
      <div className="l-chat-jump-wrap">
        <button className="l-chat-jump" type="button" onClick={() => chatRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          <Icon name="text" />Chat · {messages.length}<Icon name="down" />
        </button>
      </div>
      <section className="l-chat-wide" ref={chatRef}>
        <h2 className="l-chat-head">Chat</h2>
        {d && d.recommendations.length > 0 && (
          <GrokBlock rec={d.recommendations[d.recommendations.length - 1]} big onOpen={(rec) => setSheet({ kind: 'summary', rec })} />
        )}
        <Chat messages={messages} me={me} name={name} members={d?.members ?? []}
          recs={(d?.recommendations ?? []).slice(0, -1)} onGrok={(rec) => setSheet({ kind: 'summary', rec })} />
        {grokJob && <GrokStatus job={grokJob} onDismiss={() => setGrokJob(null)} />}
        <Composer id={id} />
      </section>

      {sheet?.kind === 'settings' && d && <Settings pact={pact} d={d} onClose={() => setSheet(null)} onAddPeople={() => setSheet({ kind: 'addPeople' })} onAddItem={() => setSheet({ kind: 'addItem' })} />}
      {sheet?.kind === 'addPeople' && d && <AddPeople id={id} d={d} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'addItem' && <AddItem pact={pact} messages={messages} name={name} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'summary' && <Summary rec={sheet.rec} booking={b && b.rec.recommendation_id === sheet.rec.recommendation_id ? b : null} onBooking={(bk) => setSheet({ kind: 'booking', booking: bk })} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'booking' && d && <BookingDetail b={sheet.booking} d={d} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'grok' && <GrokInfo onClose={() => setSheet(null)} />}
      {sheet?.kind === 'person' && <Person member={sheet.member} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'action' && d && <ActionSheet id={id} action={sheet.action} d={d} iCoordinate={iCoordinate} onClose={() => setSheet(null)} />}
    </main>
  )
}

function DateFact({ pact }: { pact: S.Pact }) {
  if (!pact.starts_on) return <div className="l-fact"><div className="l-fact-icon"><Icon name="calendar" /></div><div><b>Dates to be decided</b><span>The coordinator can add them in Settings.</span></div></div>
  const start = S.day(pact.starts_on)
  const end = pact.ends_on && pact.ends_on !== pact.starts_on ? S.day(pact.ends_on) : null
  return (
    <div className="l-fact">
      <div className="l-fact-icon"><small>{start.toLocaleDateString('en-US', { month: 'short' })}</small><b>{start.getDate()}</b></div>
      <div>
        <b>{start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</b>
        <span>{end ? `to ${end.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}` : 'One day'}</span>
      </div>
    </div>
  )
}

function grokStatus(d: S.PactData | undefined, b: S.Booking | null | undefined) {
  if (!d || !b) return 'Summary'
  const k = S.consent(d, b)
  if (!k) return 'Wrote this up'
  return k.status === 'approved' ? 'Everyone approved' : k.status === 'rejected' ? 'Not yet' : `Approving · ${k.approvals} of ${k.eligible}`
}

/** The one thing to do next, like Luma's "Thank you for joining" card and the iOS floating step. */
function StepCard({ step, hasGrok, working, onAct, onDecline, chain, members, me }: {
  step: S.Step; hasGrok: boolean; working: string | null; onAct: () => void; onDecline?: () => void
  chain: S.Chain | null; members: S.Member[]; me: string
}) {
  const label = S.stepLabel(step, hasGrok)
  const heading: Record<S.Step['kind'], string> = {
    talk: hasGrok ? 'Keep planning' : 'Talk it through', declined: 'Not yet', approve: 'Approve the plan', waitingApprovals: 'Waiting on the group',
    needsWallet: 'Everyone approved', settingUp: 'Everyone approved', waitSetup: 'Everyone approved', startCollecting: 'Start collecting',
    waitStart: 'Split is ready', pay: 'Approve your share', waitPay: 'Collecting', finalise: 'Everyone has paid', waitFinalise: 'Everyone has paid',
    done: 'Booked', cancelled: 'Cancelled',
  }
  const body: Partial<Record<S.Step['kind'], string>> = {
    talk: 'Agree in the chat on what to book, with the link and price. Then Grok writes it up for everyone to approve.',
    declined: 'Someone said not yet. Talk it through again, then ask Grok for a new write-up.',
    approve: 'Grok wrote up what the group agreed. Everyone approves before anyone pays.',
    needsWallet: 'Set your PIN to make the wallet everyone pays into.',
    startCollecting: 'The split is saved. Open it so everyone can pay their share.',
    pay: 'Pay your share into the pact. It goes to the coordinator once everyone has paid.',
    finalise: 'Release the money to yourself and book it.',
  }
  const showProgress = chain && chain.state === 'open'
  return (
    <div className="l-card l-status">
      <div className="l-stack">{members.slice(0, 5).map((m) => <Avatar key={m.user_id} name={m.name} url={m.avatar_url} size={32} />)}</div>
      <h3>{heading[step.kind]}</h3>
      <p>{body[step.kind] ?? label.text}</p>
      {showProgress && <>
        <div className="l-progress"><i style={{ width: `${(chain.sharesPaid / Math.max(1, chain.sharesNeeded)) * 100}%` }} /></div>
        <p style={{ fontSize: 13 }}>{chain.sharesPaid} of {chain.sharesNeeded} paid · {S.dollars(Number(chain.share.usdc) || 0)} each{chain.members.find((m) => m.userId === me)?.paid ? ' · you’re in' : ''}</p>
      </>}
      {working ? <Busy text={working} /> : label.action && (
        <div className="l-status-actions">
          <button className="l-btn" type="button" onClick={onAct}>{label.text}</button>
          {onDecline && <button className="l-btn l-ghost" type="button" onClick={onDecline}>Not yet</button>}
        </div>
      )}
    </div>
  )
}

/** Booked (or cancelled): a seal, what was paid and to whom, and every check behind it, each linked to its transaction. */
function BookedCard({ step, d, proof, me, name }: { step: S.Step; d: S.PactData; proof: S.Verification; me: string; name: (id: string) => string }) {
  const done = step.kind === 'done'
  const share = Number(d.chain?.share.usdc ?? 0)
  return (
    <div className="l-card l-booked">
      <div className="l-booked-top">
        <span className={done ? 'l-seal' : 'l-seal cancelled'}><Icon name={done ? 'seal' : 'x'} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>{done ? 'Booked' : 'Cancelled'}</h3>
          <p>{done && step.kind === 'done' ? `${S.dollars(step.total)} paid to ${step.host}` : 'Everyone can take their share back'}</p>
        </div>
        {proof.level !== 'none' && <VerifiedBadge level={proof.level} />}
      </div>
      {proof.checks.length > 0 && (
        <div className="l-checks">
          {proof.checks.map((c, i) => {
            const m = c.userId ? d.members.find((x) => x.user_id === c.userId) : null
            const row = (
              <>
                {m ? <Avatar name={m.name} url={m.avatar_url} size={28} /> : <span className="l-ledger-icon"><Icon name="pacts" /></span>}
                <b>{c.userId === me ? 'You paid' : c.label}{c.userId && share ? ` ${S.dollars(share)}` : ''}</b>
                {c.quickNode ? <span className="ok"><Icon name="shield" />Verified by QuickNode</span> : <span className="wait"><Icon name="chain" />On Base · QuickNode pending</span>}
              </>
            )
            return c.txHash
              ? <a key={i} className="l-check-row" href={S.txLink(c.txHash)} target="_blank" rel="noreferrer" title="See it on the Base explorer">{row}</a>
              : <div key={i} className="l-check-row">{row}</div>
          })}
        </div>
      )}
      {proof.level === 'onchain' && <p style={{ fontSize: 13 }}>The Base chain shows every payment. Pact Verified appears once QuickNode has confirmed each one.</p>}
    </div>
  )
}

/** Where the pact is: 1 Plan, 2 Approve, 3 Pay, 4 Booked. */
const stages = ['Plan', 'Approve', 'Pay', 'Booked']
function stageOf(step: S.Step): number {
  switch (step.kind) {
    case 'talk': case 'declined': return 0
    case 'approve': case 'waitingApprovals': case 'needsWallet': case 'settingUp': case 'waitSetup': return 1
    case 'startCollecting': case 'waitStart': case 'pay': case 'waitPay': case 'finalise': case 'waitFinalise': return 2
    default: return 3
  }
}
function Progress({ step }: { step: S.Step }) {
  const at = stageOf(step)
  const allDone = step.kind === 'done'
  return (
    <ol className={step.kind === 'cancelled' ? 'l-progress-steps cancelled' : 'l-progress-steps'} aria-label="Pact progress">
      {stages.map((label, i) => {
        const done = i < at || allDone
        const now = i === at && !allDone
        return (
          <li key={label} className={done ? 'done' : now ? 'now' : ''} aria-current={now ? 'step' : undefined}>
            <span className="dot">{done ? <Icon name="check" /> : i + 1}</span>
            <span className="label">{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

function Items({ items }: { items: S.Item[] }) {
  const total = S.itemsTotal(items)
  return (
    <div style={{ marginTop: 6 }}>
      {items.map((i) => (
        <div className="l-item" key={i.item_id}>
          <div className="l-item-icon"><Icon name={i.kind} /></div>
          <div style={{ minWidth: 0 }}><b>{i.title}</b><span>{[S.itemTitle(i.kind), S.dateRange(i.starts_on, i.ends_on), i.location].filter(Boolean).join(' · ')}</span></div>
          {i.price_each != null && <span className="l-item-price">{S.dollars(i.price_each)}</span>}
          {i.link && <a className="l-icon-btn" href={i.link} target="_blank" rel="noreferrer" aria-label="Open link"><Icon name="link" /></a>}
        </div>
      ))}
      {total != null && <div className="l-item"><b style={{ flex: 1 }}>Each person pays</b><span className="l-item-price">{S.dollars(total)}</span></div>}
    </div>
  )
}

function Chat({ messages, recs, onGrok, me, name, members }: { messages: S.Message[]; recs: S.Recommendation[]; onGrok: (rec: S.Recommendation) => void; me: string; name: (id: string) => string; members: S.Member[] }) {
  const end = useRef<HTMLDivElement>(null)
  const seen = useRef<number | null>(null)
  // Opening a pact starts at the top. Only a new message scrolls down.
  useEffect(() => {
    if (seen.current !== null && messages.length > seen.current) end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    if (messages.length) seen.current = messages.length
  }, [messages.length])
  type Entry = { kind: 'message'; at: string; m: S.Message } | { kind: 'grok'; at: string; rec: S.Recommendation }
  const entries: Entry[] = [
    ...messages.map((m) => ({ kind: 'message' as const, at: m.created_at, m })),
    ...recs.map((rec) => ({ kind: 'grok' as const, at: rec.created_at, rec })),
  ].sort((x, y) => x.at.localeCompare(y.at))
  if (!entries.length) return <p className="l-chat-empty">Say hi to the group. Talk through what to book, and Grok will write it up when you're ready.</p>
  return (
    <div className="l-chat">
      {entries.map((e, i) => {
        const prev = entries[i - 1]
        const day = new Date(e.at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        const newDay = !prev || new Date(prev.at).toDateString() !== new Date(e.at).toDateString()
        const divider = newDay && <div className="l-chat-day" key={`d${i}`}><span>{day}</span></div>
        if (e.kind === 'grok') return [divider, <GrokBlock key={e.rec.recommendation_id} rec={e.rec} onOpen={onGrok} />]
        const m = e.m
        const mine = m.sender_id === me
        const first = newDay || prev?.kind !== 'message' || prev.m.sender_id !== m.sender_id
        const who = members.find((x) => x.user_id === m.sender_id)
        return [divider, (
          <div key={m.message_id} className={mine ? 'l-msg me' : 'l-msg'}>
            {!mine && (first ? <Avatar name={who?.name} url={who?.avatar_url} size={44} /> : <span style={{ width: 44, flex: "none" }} />)}
            <div className="l-bubble">{!mine && first && <small>{S.firstName(name(m.sender_id))}</small>}{m.body}</div>
          </div>
        )]
      })}
      <div ref={end} />
    </div>
  )
}

type Recognition = {
  start: () => void; stop: () => void; abort: () => void; continuous: boolean; interimResults: boolean; lang: string
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}
type RecognitionCtor = new () => Recognition

const speechMessages: Record<string, string> = {
  'not-allowed': 'Microphone is blocked. Allow it for this site in the address bar, then try again.',
  'service-not-allowed': 'Voice typing is turned off in this browser. Try Chrome or Safari.',
  'audio-capture': 'No microphone found. Plug one in or check your sound settings.',
  network: "This browser can't reach its speech service. Voice typing works in Chrome and Safari.",
  'language-not-supported': "Voice typing doesn't support English here. Try Chrome or Safari.",
}

/** Talk instead of type, with the browser's own speech recognition. Words appear as you speak. */
function useDictation(onText: (text: string) => void) {
  const Ctor = (window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor })
  const Speech = Ctor.SpeechRecognition ?? Ctor.webkitSpeechRecognition
  const [listening, setListening] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const rec = useRef<Recognition | null>(null)
  const want = useRef(false)
  const said = useRef('')

  const stop = useCallback(() => { want.current = false; rec.current?.stop(); setListening(false) }, [])
  useEffect(() => () => { want.current = false; rec.current?.abort() }, [])

  async function start(before: string) {
    setFailure(null)
    if (!Speech) { setFailure("This browser can't do voice typing. Try Chrome or Safari."); return }
    // Ask for the microphone first, so the browser shows its permission prompt and a refusal is clear.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
    } catch (e) {
      setFailure((e as DOMException).name === 'NotFoundError' ? speechMessages['audio-capture'] : speechMessages['not-allowed'])
      return
    }
    said.current = before ? `${before.trim()} ` : ''
    want.current = true
    const begin = () => {
      const r = new Speech()
      r.continuous = true; r.interimResults = true; r.lang = 'en-US'
      let finalText = ''
      r.onresult = (e) => {
        let interim = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const piece = e.results[i][0].transcript
          if (e.results[i].isFinal) finalText += piece; else interim += piece
        }
        onText((said.current + finalText + interim).replace(/\s+/g, ' '))
      }
      r.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return
        want.current = false
        setListening(false)
        setFailure(speechMessages[e.error] ?? "Voice typing stopped. Try again.")
      }
      // Chrome stops after a pause; keep listening until the person taps stop.
      r.onend = () => {
        said.current = `${said.current}${finalText}`.replace(/\s+/g, ' ')
        if (said.current && !said.current.endsWith(' ')) said.current += ' '
        if (want.current) { try { begin() } catch { setListening(false) } } else setListening(false)
      }
      rec.current = r
      r.start()
    }
    try { begin(); setListening(true) } catch { setFailure('Voice typing could not start. Try again.'); want.current = false }
  }

  return { supported: Boolean(Speech), listening, failure, start, stop, clear: () => setFailure(null) }
}

function Composer({ id }: { id: string }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const voice = useDictation(setText)
  async function submit() {
    const body = text.trim()
    if (!body) return
    voice.stop()
    setText('')
    try { await S.send(id, body) } catch (e) { setError((e as Error).message); setText(body) }
  }
  return (
    <>
      {(error || voice.failure) && <p className="l-error">{error ?? voice.failure}</p>}
      <form className="l-composer" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <textarea rows={1} value={text} placeholder={voice.listening ? 'Listening… speak now' : 'Message the group'} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit() } }} />
        <button type="button" className={voice.listening ? 'l-icon-btn l-mic on' : 'l-icon-btn l-mic'} onClick={() => (voice.listening ? voice.stop() : void voice.start(text))}
          aria-label={voice.listening ? 'Stop talking' : 'Talk instead of typing'} title={voice.listening ? 'Stop' : 'Talk instead of typing'}>
          <Icon name={voice.listening ? 'wave' : 'mic'} />
        </button>
        <button type="submit" className="l-send" disabled={!text.trim()} aria-label="Send"><Icon name="up" /></button>
      </form>
    </>
  )
}

function Settings({ pact, d, onClose, onAddPeople, onAddItem }: { pact: S.Pact; d: S.PactData; onClose: () => void; onAddPeople: () => void; onAddItem: () => void }) {
  const { me, refresh, refreshPact } = useApp()
  const iCoordinate = S.coordinator(d)?.user_id === me
  const locked = Boolean(d.plan)
  const [editing, setEditing] = useState(false)
  const [details, setDetails] = useState(() => S.detailsOf(pact))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function act(work: () => Promise<unknown>) {
    setBusy(true); setError(null)
    try { await work(); await Promise.all([refresh(), refreshPact(pact.pact_id)]) } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }
  const info = S.detailsOf(pact)
  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="l-head" style={{ margin: '0 0 6px' }}><b className="l-dim">People</b><button className="l-link" type="button" onClick={onAddPeople}>Add people</button></div>
      {d.members.map((m) => (
        <div key={m.user_id} className="l-person">
          <Avatar name={m.name} url={m.avatar_url} size={30} /><b>{m.user_id === me ? 'You' : m.name ?? 'Someone'}</b>
          <small>{m.role === 'host' ? 'Coordinator' : 'Member'}</small>
          {iCoordinate && m.user_id !== me && !locked && <button className="l-btn l-ghost l-small" type="button" disabled={busy}
            onClick={() => { if (confirm(`Remove ${S.firstName(m.name)} from this pact?`)) void act(() => S.removeMember(pact.pact_id, m.user_id)) }}>Remove</button>}
        </div>
      ))}
      {d.joinRequests.map((r) => <div key={r.user_id} className="l-person pending"><Avatar name={r.name} url={r.avatar_url} size={30} /><b>{r.name ?? 'Someone'}</b><small>Pending</small></div>)}
      <div className="l-person"><span className="l-av" style={{ width: 30, height: 30, background: '#000' }}><Grok size={16} /></span><b>Grok</b><small>Planner</small></div>
      {locked && <p className="l-faint" style={{ fontSize: 13 }}>People are locked once the split is set up.</p>}

      <div className="l-head" style={{ margin: '22px 0 6px' }}><b className="l-dim">Overview</b>{iCoordinate && !editing && <button className="l-link" type="button" onClick={() => setEditing(true)}>Edit overview</button>}</div>
      {editing ? (
        <div className="l-form">
          <DetailsForm value={details} onChange={setDetails} />
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="l-btn" type="button" disabled={busy} onClick={() => void act(async () => { await S.saveDetails(pact.pact_id, details); setEditing(false) })}>{busy ? 'Saving…' : 'Save'}</button>
            <button className="l-btn l-ghost" type="button" onClick={() => { setDetails(S.detailsOf(pact)); setEditing(false) }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="l-kv">
          <span>Kind</span><b>{S.cap(info.kind)}</b>
          <span>What it is</span><b>{info.about || 'Not set'}</b>
          <span>Where</span><b>{info.location || 'Not set'}</b>
          <span>Dates</span><b>{S.dateRange(pact.starts_on, pact.ends_on) ?? 'Not set'}</b>
          <span>Budget each</span><b>{info.budget != null ? S.dollars(info.budget) : 'Not set'}</b>
          <span>Link</span><b>{info.link ? <a href={info.link} target="_blank" rel="noreferrer">{info.link.replace(/^https?:\/\//, '')}</a> : 'Not set'}</b>
        </div>
      )}

      <div className="l-head" style={{ margin: '24px 0 4px' }}>
        <b className="l-dim">Itinerary</b>
        {S.itemsTotal(d.items) != null && <span className="l-dim" style={{ fontSize: 14, fontWeight: 600 }}>{S.dollars(S.itemsTotal(d.items)!)} each</span>}
      </div>
      {d.items.length ? d.items.map((i) => (
        <div className="l-item" key={i.item_id}>
          <div className="l-item-icon"><Icon name={i.kind} /></div>
          <div style={{ minWidth: 0, flex: 1 }}><b>{i.title}</b><span>{[S.itemTitle(i.kind), S.dateRange(i.starts_on, i.ends_on), i.location].filter(Boolean).join(' · ')}</span></div>
          {i.price_each != null && <span className="l-item-price">{S.dollars(i.price_each)}</span>}
          {i.link && <a className="l-icon-btn" href={i.link} target="_blank" rel="noreferrer" aria-label="Open link"><Icon name="link" /></a>}
          {!locked && (i.created_by === me || iCoordinate) && <button className="l-remove" type="button" disabled={busy} onClick={() => void act(() => S.removeItem(i.item_id))}>Remove</button>}
        </div>
      )) : <p className="l-faint" style={{ fontSize: 14 }}>Nothing added yet. Add the stays, flights, tickets and dinners you're booking.</p>}
      {!locked && <button className="l-btn l-ghost l-wide-btn" style={{ marginTop: 12 }} type="button" onClick={onAddItem}><Icon name="plus" size={16} />Add to itinerary</button>}
      {error && <p className="l-error">{error}</p>}
    </Modal>
  )
}

function AddPeople({ id, d, onClose }: { id: string; d: S.PactData; onClose: () => void }) {
  const { friends, refreshPact } = useApp()
  const taken = new Set([...d.members.map((m) => m.user_id), ...d.joinRequests.map((r) => r.user_id)])
  const open = friends.filter((f) => !taken.has(f.member.user_id))
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal title="Add people" onClose={onClose}>
      {!open.length && <p className="l-dim">{friends.length ? 'All your friends are already in or asked.' : 'Add friends in the Friends tab first.'}</p>}
      {open.map((f) => {
        const on = picked.includes(f.member.user_id)
        return (
          <button key={f.member.user_id} type="button" className="l-pick" onClick={() => setPicked(on ? picked.filter((x) => x !== f.member.user_id) : [...picked, f.member.user_id])}>
            <Avatar name={f.member.name} url={f.member.avatar_url} size={30} /><b>{f.member.name ?? 'Someone'}</b>
            <span className={on ? 'l-check on' : 'l-check'}>{on && <Icon name="check" />}</span>
          </button>
        )
      })}
      {error && <p className="l-error">{error}</p>}
      {open.length > 0 && <button className="l-btn l-wide-btn" style={{ marginTop: 14 }} type="button" disabled={busy || !picked.length}
        onClick={async () => { setBusy(true); try { await S.invite(id, picked); await refreshPact(id); onClose() } catch (e) { setError((e as Error).message); setBusy(false) } }}>
        {busy ? 'Asking…' : picked.length ? `Ask ${picked.length} in` : 'Ask them in'}
      </button>}
    </Modal>
  )
}

const placeholders: Record<S.ItemKind, string> = { stay: 'South Congress house', flight: 'Austin to San Antonio', ticket: 'Blockchain summit passes', dinner: 'Team dinner', other: 'Anything else' }

function AddItem({ pact, messages, name, onClose }: { pact: S.Pact; messages: S.Message[]; name: (id: string) => string; onClose: () => void }) {
  const { refreshPact } = useApp()
  const kinds = S.presets[S.detailsOf(pact).kind]
  const [draft, setDraft] = useState<S.ItemDraft>({ kind: kinds[0], title: '', location: '', startsOn: null, endsOn: null, link: '', price: null })
  const [working, setWorking] = useState<'add' | 'grok' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<S.ItemDraft>) => setDraft({ ...draft, ...patch })
  async function go(kind: 'add' | 'grok', work: () => Promise<unknown>) {
    setWorking(kind); setError(null)
    try { await work(); await refreshPact(pact.pact_id); onClose() } catch (e) { setError((e as Error).message); setWorking(null) }
  }
  return (
    <Modal title="Add item" onClose={onClose}>
      <form className="l-form" onSubmit={(e) => { e.preventDefault(); if (draft.title.trim()) void go('add', () => S.addItem(pact.pact_id, draft)) }}>
        <div className="l-kinds">{kinds.map((k) => <button key={k} type="button" className={draft.kind === k ? 'on' : ''} onClick={() => set({ kind: k })}><Icon name={k} />{S.itemTitle(k)}</button>)}</div>
        <label className="l-field"><span>Name</span><input className="l-input" autoFocus value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder={placeholders[draft.kind]} maxLength={120} /></label>
        <label className="l-field"><span>Where</span><input className="l-input" value={draft.location} onChange={(e) => set({ location: e.target.value })} placeholder="Optional" /></label>
        <Switch on={Boolean(draft.startsOn)} label="Dates" onChange={(on) => set(on ? { startsOn: pact.starts_on ?? S.today(), endsOn: pact.ends_on ?? pact.starts_on ?? S.today() } : { startsOn: null, endsOn: null })} />
        {draft.startsOn && <div className="l-two">
          <label className="l-field"><span>From</span><input className="l-input" type="date" value={draft.startsOn} onChange={(e) => set({ startsOn: e.target.value })} /></label>
          <label className="l-field"><span>To</span><input className="l-input" type="date" value={draft.endsOn ?? ''} min={draft.startsOn} onChange={(e) => set({ endsOn: e.target.value })} /></label>
        </div>}
        <div className="l-two">
          <label className="l-field"><span>Price each</span><input className="l-input" inputMode="decimal" value={draft.price ?? ''} onChange={(e) => set({ price: e.target.value === '' ? null : Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })} placeholder="$" /></label>
          <label className="l-field"><span>Link</span><input className="l-input" value={draft.link} onChange={(e) => set({ link: e.target.value })} placeholder="Booking link" /></label>
        </div>
        {error && <p className="l-error">{error}</p>}
        <button className="l-btn l-wide-btn" type="submit" disabled={Boolean(working) || !draft.title.trim()}>{working === 'add' ? 'Adding…' : `Add ${S.itemTitle(draft.kind).toLowerCase()}`}</button>
        <button className="l-btn l-ghost l-wide-btn" type="button" disabled={Boolean(working)} onClick={() => void go('grok', () => S.addItemsWithGrok(pact.pact_id, messages, name))}>
          {working === 'grok' ? <Busy text="Grok is reading the chat…" /> : <><img src="/grok.svg" alt="" width={16} />Add from the chat with Grok</>}
        </button>
      </form>
    </Modal>
  )
}

/** One Grok write-up, spaced out: what it said, what it picked, and the next steps. */
function Summary({ rec, booking, onBooking, onClose }: { rec: S.Recommendation; booking: S.Booking | null; onBooking: (b: S.Booking) => void; onClose: () => void }) {
  const when = new Date(rec.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const pick = rec.options[0]
  return (
    <Modal title={<span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}><Grok size={26} />Grok</span>} onClose={onClose}>
      <div className="l-sum-block">
        <small>{when}</small>
        {rec.summary.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}
        {pick && (
          <div className="l-sum-pick">
            <span className="l-sum-pick-label">Grok picked</span>
            <b>{pick.title}</b>
            {pick.price_per_person != null && <span className="l-sum-pick-price">{S.dollars(pick.price_per_person)} each</span>}
          </div>
        )}
      </div>
      {booking && <button className="l-btn l-wide-btn l-sum-cta" type="button" onClick={() => onBooking(booking)}>See what you're booking<Icon name="link" size={16} /></button>}
      {rec.next_steps?.length > 0 && <div className="l-sum-block">
        <small>Next steps</small>
        <ul>{rec.next_steps.map((x, i) => <li key={i}>{x}</li>)}</ul>
      </div>}
    </Modal>
  )
}

/** A Grok write-up in the chat. The first, big setup is shown large at the top; each later question gets its own block. */
function GrokBlock({ rec, big, onOpen }: { rec: S.Recommendation; big?: boolean; onOpen: (rec: S.Recommendation) => void }) {
  const pick = rec.options[0]
  const when = new Date(rec.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return (
    <button type="button" className={big ? 'l-grok-block big' : 'l-grok-block'} onClick={() => onOpen(rec)}>
      <span className="l-av l-grok-av" style={{ width: big ? 48 : 40, height: big ? 48 : 40 }}><Grok size={big ? 26 : 22} /></span>
      <span className="l-grok-block-main">
        <b>{big ? 'Grok set up this pact' : 'Grok'} <small>· {when}</small></b>
        <span className="text">{rec.summary}</span>
        {pick && <span className="l-grok-block-pick">{pick.title}{pick.price_per_person != null ? ` · ${S.dollars(pick.price_per_person)} each` : ''}</span>}
      </span>
      <span className="l-grok-one-open">Open</span>
    </button>
  )
}

/** Grok at work, at the bottom of the chat: thinking, taking longer, or failed with a way to try again. */
function GrokStatus({ job, onDismiss }: { job: { label: string; slow: boolean; error: string | null; retry: () => void }; onDismiss: () => void }) {
  return (
    <div className={job.error ? 'l-grok-status error' : 'l-grok-status'}>
      <span className="l-av l-grok-av" style={{ width: 40, height: 40 }}><Grok size={22} /></span>
      <div className="l-grok-status-main">
        {job.error ? <><b>Grok couldn't answer</b><span>{job.error}</span></>
          : <><b>{job.slow ? 'Grok is taking longer than usual…' : job.label}</b><span className="l-dots"><i /><i /><i /></span></>}
      </div>
      {job.error && <div className="l-grok-status-actions">
        <button className="l-btn l-small" type="button" onClick={job.retry}>Try again</button>
        <button className="l-btn l-ghost l-small" type="button" onClick={onDismiss}>Dismiss</button>
      </div>}
    </div>
  )
}

function BookingDetail({ b, d, onClose }: { b: S.Booking; d: S.PactData; onClose: () => void }) {
  const k = S.consent(d, b)
  return (
    <Modal title={b.option.title} onClose={onClose}>
      {b.perPerson != null && <div style={{ marginBottom: 14 }}><span style={{ fontSize: 34, fontWeight: 800 }}>{S.dollars(b.perPerson)}</span> <span className="l-dim">each</span>
        <div className="l-dim" style={{ fontSize: 14 }}>{b.people} people · {S.dollars(b.total ?? 0)} in total</div></div>}
      <b className="l-dim">What it is</b>
      <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{b.option.description}</p>
      {b.option.tradeoff && <><b className="l-dim">Worth knowing</b><p style={{ lineHeight: 1.5 }}>{b.option.tradeoff}</p></>}
      {k && <p className="l-dim">{k.status === 'approved' ? 'Everyone approved.' : `${k.approvals} of ${k.eligible} have approved.`}</p>}
      {b.option.link && <a className="l-btn l-wide-btn" href={b.option.link} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>Open {safeHost(b.option.link)}<Icon name="link" size={15} /></a>}
    </Modal>
  )
}
const safeHost = (link: string) => { try { return new URL(link).host } catch { return 'the link' } }

function GrokInfo({ onClose }: { onClose: () => void }) {
  const line = (icon: string, title: string, text: string) => (
    <div className="l-item"><div className="l-item-icon"><Icon name={icon} /></div><div><b>{title}</b><span>{text}</span></div></div>
  )
  return (
    <Modal title={<span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}><Grok size={26} />Grok</span>} onClose={onClose}>
      <p className="l-dim" style={{ marginTop: 0 }}>Your pact's planner</p>
      {line('text', 'Reads the group chat', 'When you tap Set up with Grok, it reads what everyone said.')}
      {line('list', 'Writes up the booking', 'The one thing you agreed on, its link, and the price for each person.')}
      {line('checkCircle', 'Never touches money', "Everyone approves their own share. Grok can't pay or book on its own.")}
      <p className="l-dim" style={{ fontSize: 14 }}>Connected through Pact. Nothing to set up.</p>
      <a className="l-btn l-ghost l-wide-btn" href="https://grok.com" target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>Open your own Grok<Icon name="link" size={15} /></a>
    </Modal>
  )
}

function Person({ member, onClose }: { member: S.Member; onClose: () => void }) {
  const { me, friends, pacts, data, go } = useApp()
  const mine = member.user_id === me
  const shared = (pacts ?? []).filter((p) => mine || data[p.pact_id]?.members.some((m) => m.user_id === member.user_id))
  const friend = friends.some((f) => f.member.user_id === member.user_id)
  return (
    <Modal title="" onClose={onClose}>
      <div style={{ display: 'grid', justifyItems: 'center', gap: 8, marginTop: -20 }}>
        <Avatar name={member.name} url={member.avatar_url} size={76} />
        <b style={{ fontSize: 22 }}>{mine ? 'You' : member.name ?? 'Someone'}</b>
        <span className="l-dim" style={{ fontWeight: 600 }}>{member.role === 'host' ? 'Coordinator' : 'Member'}{!mine && ` · ${friend ? 'Friends' : 'In this pact with you'}`}</span>
      </div>
      <h2 className="l-h2" style={{ marginTop: 22 }}>{mine ? 'Your pacts' : 'Pacts you share'}</h2>
      {shared.map((p) => (
        <button key={p.pact_id} type="button" className="l-pick" onClick={() => { onClose(); go(`/pacts/${p.pact_id}`) }}>
          <span className="l-item-icon"><Icon name={S.detailsOf(p).kind} /></span><b>{p.name}</b><span className="l-faint">{S.dateRange(p.starts_on, p.ends_on)}</span>
        </button>
      ))}
    </Modal>
  )
}

/** Start collecting, pay my share, or finalise: one PactSplit call, confirmed with my PIN. */
function ActionSheet({ id, action, d, iCoordinate, onClose }: { id: string; action: 'create_pact' | 'pay_share' | 'release'; d: S.PactData; iCoordinate: boolean; onClose: () => void }) {
  const { me, refreshPact, setWallet } = useApp()
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const chain = d.chain
  const share = Number(chain?.share.usdc ?? d.plan?.share_usdc ?? 0)
  const total = Number(chain?.total.usdc ?? 0) || share * (d.plan?.shares_needed ?? d.members.length)
  const copy = {
    create_pact: { title: 'Start collecting', text: `Open the split so everyone can pay their ${S.dollars(share)} share. It all comes to you once everyone has paid.`, button: 'Start collecting' },
    pay_share: { title: 'Approve your share', text: `Pay ${S.dollars(share)} into the pact. It's held until everyone has paid, then goes to the coordinator.`, button: `Approve ${S.dollars(share)}` },
    release: { title: 'Finalise and book', text: `Everyone has paid. Release ${S.dollars(total)} to yourself, then book it.`, button: `Finalise · ${S.dollars(total)}` },
  }[action]
  return (
    <Modal title={copy.title} onClose={onClose}>
      <p className="l-dim" style={{ marginTop: 0, lineHeight: 1.5 }}>{copy.text}</p>
      {chain && chain.state !== 'none' && <>
        <b className="l-dim">Who's paid</b>
        {d.members.map((m) => {
          const c = chain.members.find((x) => x.userId === m.user_id)
          return (
            <div key={m.user_id} className="l-person">
              <Avatar name={m.name} url={m.avatar_url} size={28} /><b>{m.user_id === me ? 'You' : m.name ?? 'Someone'}</b>
              <small style={c?.paid ? { color: 'var(--go)' } : undefined}>{!c?.address ? 'No wallet yet' : c.paid ? 'Paid' : `Owes ${S.dollars(share)}`}</small>
            </div>
          )
        })}
      </>}
      {error && <p className="l-error">{error}</p>}
      <div style={{ marginTop: 18 }}>
        {state === 'done' ? <button className="l-btn l-wide-btn" type="button" onClick={onClose}>Done</button>
          : state === 'busy' ? <Busy text="Confirm with your PIN, then Base confirms it…" />
          : <button className="l-btn l-wide-btn" type="button" disabled={action !== 'pay_share' && !iCoordinate}
              onClick={async () => { setState('busy'); setError(null); try { await S.pactAction(action, id); await refreshPact(id); setWallet(await S.loadWallet()); setState('done') } catch (e) { setError((e as Error).message); setState('idle') } }}>{copy.button}</button>}
      </div>
    </Modal>
  )
}
