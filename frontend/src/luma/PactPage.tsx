import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import * as S from './store'
import { DetailsForm, useApp } from './App'
import { Avatar, Busy, Cover, Grok, Icon, Modal, Switch, VerifiedBadge } from './ui'
import { PilotAnswerView } from './PilotCard'

type Sheet =
  | { kind: 'settings' } | { kind: 'addPeople' } | { kind: 'addItem' } | { kind: 'grok' }
  | { kind: 'summary'; rec: S.Recommendation } | { kind: 'booking'; booking: S.Booking }
  | { kind: 'action'; action: 'create_pact' | 'pay_share' | 'release' } | { kind: 'person'; member: S.Member }
  | { kind: 'send'; to: string | null; cents?: number; payback?: boolean; extras?: string } | { kind: 'info' } | { kind: 'dates' } | { kind: 'budget' } | { kind: 'place' }

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
  const [polls, setPolls] = useState<S.Poll[]>([])
  const [renaming, setRenaming] = useState(false)
  const [tab, setTab] = useState<S.Tab | null>(null)
  const [extras, setExtras] = useState<S.Extras | null>(null)
  /** The right panel: the group's Pact Chat, or a private Pact Pilot conversation. */
  const [panel, setPanel] = useState<'chat' | 'pilot'>('chat')
  /** The chat (or Pact Pilot) opened full screen. Esc closes it. */
  const [fullChat, setFullChat] = useState(false)
  /** A question sent from Pact Chat with @Pilot: it opens Pact Pilot and is asked there, not posted to the group. */
  const [queued, setQueued] = useState<{ q: string; n: number } | null>(null)
  useEffect(() => {
    if (!fullChat) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') toggleFullRef.current() }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [fullChat])
  const reloadSide = useCallback(() => {
    void S.loadPolls(id).then(setPolls)
    void S.loadTab(id).then(setTab).catch(() => undefined)
    void S.loadExtras(id).then(setExtras).catch(() => undefined)
  }, [id])
  // Votes and balances refresh with the pact, every 6 seconds, and right after I act.
  useEffect(() => { reloadSide(); const t = setInterval(reloadSide, 6000); return () => clearInterval(t) }, [reloadSide, tabVersion])
  const chatRef = useRef<HTMLElement>(null)
  const slotRef = useRef<HTMLDivElement>(null)
  const dockedHeight = useRef(0)
  const animating = useRef(false)
  const HEAVY = { duration: 620, easing: 'cubic-bezier(0.7, 0, 0.2, 1)' }
  const box = (r: DOMRect) => ({ top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px`, bottom: 'auto', transform: 'none' })
  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  function toggleFull() {
    const el = chatRef.current
    if (!el || animating.current) return
    if (reduced()) { setFullChat((f) => !f); return }
    animating.current = true
    const from = el.getBoundingClientRect()
    if (!fullChat) {
      dockedHeight.current = from.height
      setFullChat(true)
      requestAnimationFrame(() => {
        const to = el.getBoundingClientRect()
        const anim = el.animate([box(from), box(to)], HEAVY)
        anim.onfinish = anim.oncancel = () => { animating.current = false }
      })
    } else {
      const to = slotRef.current?.getBoundingClientRect()
      if (!to) { setFullChat(false); animating.current = false; return }
      el.classList.add('closing')
      const anim = el.animate([box(from), box(to)], { ...HEAVY, duration: 560, fill: 'forwards' })
      anim.onfinish = () => { setFullChat(false); el.classList.remove('closing'); requestAnimationFrame(() => anim.cancel()); animating.current = false }
    }
  }
  const toggleFullRef = useRef(toggleFull)
  toggleFullRef.current = toggleFull
  const findingsRef = useRef<HTMLDivElement>(null)
  /** What Pact Pilot is doing right now, shown at the bottom of the chat: thinking, slow, or failed with a retry. */
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
    S.setGrokRetryListener(() => setWorking('Pact Pilot is taking longer than usual…'))
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
    catch (e) { setGrokJob({ label, slow: false, error: (e as Error).message || "Pact Pilot couldn't answer. Try again.", retry: again }) }
    finally { S.setGrokRetryListener(null) }
  }, [id, refreshPact])

  const step = d ? S.step(d, me, Boolean(wallet)) : null
  const messageFindings = messages
    .map((m) => ({ m, found: S.parseOptions(m.body) }))
    .filter((f): f is { m: S.Message; found: NonNullable<ReturnType<typeof S.parseOptions>> } => f.found !== null)
    .filter((f) => !polls.some((p) => p.created_at >= f.m.created_at && p.options.length === f.found.options.length && p.options[0]?.name === f.found.options[0]?.name))
    .reverse()

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
      case 'talk': case 'declined': return void runGrok('Pact Pilot is reading the chat to write up what to book…', askBook)
      case 'approve': return void run(wallet ? 'Approving…' : 'Set your PIN…', async () => { await S.approve(step.decision, wallet); if (!wallet) app.setWallet(await S.loadWallet()) })
      case 'needsWallet': return void run('Set your PIN…', async () => app.setWallet(await S.makeWallet()))
      case 'startCollecting': return setSheet({ kind: 'action', action: 'create_pact' })
      case 'pay': return setSheet({ kind: 'action', action: 'pay_share' })
      case 'finalise': return setSheet({ kind: 'action', action: 'release' })
    }
  }

  return (
    <main className="l-page l-pact-full">
      <div className={fullChat ? "l-pact-grid chat-full" : "l-pact-grid"}>
        {/* Left: the people, and sending money to any of them. */}
        <aside className="l-pact-people">
          <Cover kind={details.kind} name={pact.name} sub={pact.location} big />
          {host && (<div className="l-pact-coord-wrap">
            <div className="l-pact-coord">
              <button type="button" className="l-people-who" onClick={() => setSheet({ kind: 'person', member: host })}>
                <Avatar name={host.name} url={host.avatar_url} size={46} />
                <span>
                  <b className="big">{host.user_id === me ? 'You' : host.name ?? 'Someone'}</b>
                  <small className="host"><Icon name="crown" size={12} />Coordinator</small>
                </span>
              </button>
              {shareBalance(d, host.user_id, me) ?? (host.user_id !== me ? <NetBalance who={host} me={me} tab={tab} onSettle={(cents) => setSheet({ kind: 'send', to: host.user_id, cents, payback: true })} /> : <MyBalance me={me} tab={tab} />)}
            </div>
          </div>)}
          {/* Everyone else: photo, name (cut with … if long), role under it, then their buttons. Nothing sits beside the name. */}
          <div className="l-people">
            {d?.members.filter((m) => m.role !== 'host').map((m) => (<div key={m.user_id} className="l-people-item">
              <div className="l-people-row">
                <button type="button" className="l-people-who" onClick={() => setSheet({ kind: 'person', member: m })}>
                  <Avatar name={m.name} url={m.avatar_url} size={36} />
                  <span><b>{m.user_id === me ? 'You' : m.name ?? 'Someone'}</b><small>Member</small></span>
                </button>
                {shareBalance(d, m.user_id, me) ?? (m.user_id !== me ? <NetBalance who={m} me={me} tab={tab} onSettle={(cents) => setSheet({ kind: 'send', to: m.user_id, cents, payback: true })} /> : <MyBalance me={me} tab={tab} />)}
              </div>
            </div>))}
            {d?.joinRequests.map((r) => (
              <div key={r.user_id} className="l-people-row pending">
                <span className="l-people-who"><Avatar name={r.name} url={r.avatar_url} size={36} /><span><b>{r.name ?? 'Someone'}</b><small>Pending</small></span></span>
              </div>
            ))}
            <div className="l-people-row">
              <button type="button" className="l-people-who" onClick={() => setSheet({ kind: 'grok' })}>
                <span className="l-av" style={{ width: 36, height: 36, background: '#000' }}><Grok size={18} /></span>
                <span><b>Pact Pilot</b><small>Planner</small></span>
              </button>
            </div>
          </div>
          <div className="l-pact-buttons">
            <button className="l-send-btn" type="button" onClick={() => setSheet({ kind: 'send', to: null })}><ArrowNE size={17} />Send money</button>
            <button className="l-btn l-ghost l-wide-btn" type="button" onClick={() => setSheet({ kind: 'addPeople' })}><Icon name="plus" size={17} />Add people</button>
          </div>
        </aside>

        {/* Middle: the trip itself, its plan, timeline and tab. */}
        <section className="l-pact-main">
          {proof && proof.level !== 'none' && <div><VerifiedBadge level={proof.level} compact /></div>}
          {/* The name gets its own line, as long as it likes. Under it, one row: the place on the left, then the dates,
              budget, info, settings and edit on the right. */}
          <div className="l-titlebar">
            <PactTitle id={id} name={pact.name} editing={renaming} onEditing={setRenaming} canEdit={iCoordinate} onSaved={() => void app.refresh()} />
            <div className="l-meta-row">
              <TitleChip icon="pin" label={pact.location || 'Add place'} empty={!pact.location}
                canEdit={iCoordinate} hint="Where" onClick={() => setSheet({ kind: 'place' })} />
              <div className="l-meta-right">
                <TitleChip icon="calendar" label={S.dateRange(pact.starts_on, pact.ends_on) ?? 'Add dates'} empty={!pact.starts_on}
                  canEdit={iCoordinate} hint="Dates" onClick={() => setSheet({ kind: 'dates' })} />
                <TitleChip icon="wallet" label={details.budget != null ? `${S.dollars(details.budget)} each` : 'Add budget'} empty={details.budget == null}
                  canEdit={iCoordinate} hint="Budget per person" onClick={() => setSheet({ kind: 'budget' })} />
                <button className="l-round" type="button" onClick={() => setSheet({ kind: 'info' })} aria-label="Info" title="Info"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><circle cx="12" cy="7.6" r="0.6" fill="currentColor" /></svg></button>
                <button className="l-round" type="button" onClick={() => setSheet({ kind: 'settings' })} aria-label="Settings" title="Settings"><Icon name="gear" size={18} /></button>
                {iCoordinate && <button className="l-round" type="button" onClick={() => setRenaming(true)} aria-label="Rename the pact" title="Rename"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M14 6l4 4" /></svg></button>}
              </div>
            </div>
          </div>

          {step && <div className="l-pact-steps"><Progress step={step} /></div>}
          {finished && d && proof ? <BookedCard step={step!} d={d} proof={proof} me={me} name={name} />
            : step && <StepCard step={step} hasGrok={hasGrok} working={working} onAct={doStep}
            onDecline={step.kind === 'approve' ? () => void run('Saying not yet…', () => S.vote(step.decision, false)) : undefined}
            chain={d.chain} members={d.members} me={me} />}
          {error && <p className="l-error">{error}</p>}

          {!finished && <><div className="l-actions-row">
            <div className="l-actions">
            <button className="l-pill" type="button" onClick={() => setSheet({ kind: 'addItem' })}><Icon name="plus" />Add item</button>
            <button className="l-pill" type="button" disabled={Boolean(grokJob && !grokJob.error)} onClick={() => { setQueued({ q: S.summaryQuestion, n: Date.now() }); setPanel('pilot') }}><Icon name="text" />Summary</button>
            </div>
            {(step?.kind === 'talk' || step?.kind === 'declined') && <button className="l-book" type="button" disabled={Boolean(grokJob && !grokJob.error)} onClick={() => void runGrok(d?.items.length ? 'Sending it to the group to approve…' : 'Pact Pilot is writing up the plan for the group to approve…', askBook)}><Icon name="sparkles" />Send for approval</button>}
          </div>

          </>}

          {/* Findings: every set of options (Pact Pilot's hotels, flights…) as visual cards to vote on and approve. */}
          {d && (polls.length > 0 || messageFindings.length > 0) && (
            <div className="l-findings" ref={findingsRef}>
              <div className="l-section-title">Findings</div>
              {[...polls].sort((x, y) => Number(y.status === 'open') - Number(x.status === 'open') || y.created_at.localeCompare(x.created_at)).map((poll) => (
                <PollCard key={poll.poll_id} poll={poll} me={me} members={d.members} pact={pact} iCoordinate={iCoordinate}
                  onVoted={reloadSide} onAddedToPlan={() => { reloadSide(); void refreshPact(id) }} />
              ))}
              {messageFindings.map((f) => <MessageOptions key={f.m.message_id} id={id} found={f.found} onStarted={reloadSide} />)}
            </div>
          )}

          {d && d.items.length > 0 && (
            <div className="l-about">
              <div className="l-section-title">Plan</div>
              <Items items={d.items} />
            </div>
          )}

          {d && d.plan && extras && (
            <ExtrasCard extras={extras} me={me} members={d.members} working={working}
              onAdd={() => setSheet({ kind: 'addItem' })}
              onSend={() => void run('Sending the extras for approval…', async () => { await S.sendExtrasForApproval(id); reloadSide() })}
              onVote={(roundId, yes) => void run(yes ? 'Approving…' : 'Saying not yet…', async () => { await S.voteExtras(roundId, yes); reloadSide() })}
              onPay={(roundId, cents) => extras.host && setSheet({ kind: 'send', to: extras.host, cents, extras: roundId })} />
          )}


          {/* Narrow screens: the chat sits below, so offer a jump to it. */}
          <div className="l-chat-jump-wrap">
            <button className="l-chat-jump" type="button" onClick={() => chatRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              <Icon name="text" />Chat · {messages.length}<Icon name="down" />
            </button>
          </div>
        </section>

      {/* Right: the chat, always beside the plan on a wide screen. */}
      {fullChat && <div className="l-chat-backdrop" onClick={toggleFull} />}
      {/* While the chat is full screen, this keeps its spot in the page, so closing can shrink it back into place. */}
      {fullChat && <div className="l-chat-slot" ref={slotRef} style={{ height: dockedHeight.current || undefined }} />}
      <section className={fullChat ? 'l-chat-wide l-pact-chat full' : 'l-chat-wide l-pact-chat'} ref={chatRef}>
        <div className="l-chat-head l-panel-head">
          <div className="l-panel-switch" role="tablist" aria-label="Chat or Pact Pilot">
            <button type="button" role="tab" aria-selected={panel === 'chat'} className={panel === 'chat' ? 'on' : ''} onClick={() => setPanel('chat')}>Pact Chat</button>
            <button type="button" role="tab" aria-selected={panel === 'pilot'} className={panel === 'pilot' ? 'on' : ''} onClick={() => setPanel('pilot')}><Grok size={14} />Pact Pilot</button>
          </div>
          <button type="button" className="l-chat-expand" onClick={toggleFull}
            aria-label={fullChat ? 'Close full screen' : 'Open the chat full screen'} title={fullChat ? 'Close full screen (Esc)' : 'Full screen'}>
            {fullChat
              ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>
              : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>}
          </button>
        </div>
        {panel === 'pilot' && d ? (
          <PilotPanel id={id} me={me} pact={pact ?? null} d={d} queued={queued} onOpenChat={() => setPanel('chat')}
            onChanged={() => { reloadSide(); setTabVersion((v) => v + 1); void refreshPact(id) }} />
        ) : <>
        {d && d.recommendations.length > 0 && (
          <GrokBlock rec={d.recommendations[d.recommendations.length - 1]} big onOpen={(rec) => setSheet({ kind: 'summary', rec })} />
        )}
        <Chat messages={messages} me={me} name={name} members={d?.members ?? []} polls={polls} pact={pact} iCoordinate={iCoordinate}
          onVoted={reloadSide} onAddedToPlan={() => { reloadSide(); void refreshPact(id) }}
          onSeeFindings={() => findingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          recs={(d?.recommendations ?? []).slice(0, -1)} onGrok={(rec) => setSheet({ kind: 'summary', rec })} />
        {d && step && !finished && <WaitingCard d={d} me={me} step={step} hasGrok={hasGrok} working={working} onAct={doStep} />}
        {grokJob && <GrokStatus job={grokJob} onDismiss={() => setGrokJob(null)} />}
        <Composer id={id} onAskGrok={(q) => { setQueued({ q, n: Date.now() }); setPanel('pilot') }} />
        </>}
      </section>
      </div>

      {sheet?.kind === 'settings' && d && <Settings pact={pact} d={d} onClose={() => setSheet(null)} onAddPeople={() => setSheet({ kind: 'addPeople' })} onAddItem={() => setSheet({ kind: 'addItem' })} />}
      {sheet?.kind === 'addPeople' && d && <AddPeople id={id} d={d} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'addItem' && <AddItem pact={pact} messages={messages} name={name} extra={Boolean(d?.plan)} onClose={() => { setSheet(null); reloadSide() }} />}
      {sheet?.kind === 'summary' && <Summary rec={sheet.rec} booking={b && b.rec.recommendation_id === sheet.rec.recommendation_id ? b : null} onBooking={(bk) => setSheet({ kind: 'booking', booking: bk })} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'booking' && d && <BookingDetail b={sheet.booking} d={d} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'grok' && <GrokInfo onClose={() => setSheet(null)} />}
      {sheet?.kind === 'person' && <Person member={sheet.member} onSend={() => setSheet({ kind: 'send', to: sheet.member.user_id })} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'dates' && <DatesSheet pact={pact} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); void app.refresh() }} />}
      {sheet?.kind === 'place' && <PlaceSheet pact={pact} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); void app.refresh() }} />}
      {sheet?.kind === 'budget' && <BudgetSheet pact={pact} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); void app.refresh() }} />}
      {sheet?.kind === 'send' && d && <SendMoney id={id} d={d} initial={sheet.to} cents={sheet.cents} payback={sheet.payback} extras={sheet.extras} onClose={() => setSheet(null)} onSent={() => { setTabVersion((v) => v + 1); reloadSide() }} />}
      {sheet?.kind === 'info' && <InfoSheet pact={pact} canEdit={iCoordinate} onSettings={() => setSheet({ kind: 'settings' })} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'action' && d && <ActionSheet id={id} action={sheet.action} d={d} iCoordinate={iCoordinate} onClose={() => setSheet(null)} />}
    </main>
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
    waitStart: 'Split is ready', checking: 'Checking the split', pay: 'Approve your share', waitPay: 'Collecting', finalise: 'Everyone has paid', waitFinalise: 'Everyone has paid',
    done: 'Booked', cancelled: 'Cancelled',
  }
  const body: Partial<Record<S.Step['kind'], string>> = {
    talk: 'Agree in the chat on what to book, with the link and price. Then Pact Pilot writes it up for everyone to approve.',
    declined: 'Someone said not yet. Talk it through again, then ask Pact Pilot for a new write-up.',
    approve: 'Pact Pilot wrote up what the group agreed. Everyone approves before anyone pays.',
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
                {c.quickNode ? <span className="ok"><Icon name="shield" />Verified by QuickNode</span> : <span className="wait"><Icon name="chain" />On Arc · QuickNode pending</span>}
              </>
            )
            return c.txHash
              ? <a key={i} className="l-check-row" href={S.txLink(c.txHash)} target="_blank" rel="noreferrer" title="See it on the Arc explorer">{row}</a>
              : <div key={i} className="l-check-row">{row}</div>
          })}
        </div>
      )}
      {proof.level === 'onchain' && <p style={{ fontSize: 13 }}>The Arc chain shows every payment. Pact Verified appears once QuickNode has confirmed each one.</p>}
    </div>
  )
}

/** Where the pact is: 1 Plan, 2 Approve, 3 Pay, 4 Booked. */
const stages = ['Plan', 'Approve', 'Pay', 'Booked']
function stageOf(step: S.Step): number {
  switch (step.kind) {
    case 'talk': case 'declined': return 0
    case 'approve': case 'waitingApprovals': case 'needsWallet': case 'settingUp': case 'waitSetup': return 1
    case 'startCollecting': case 'waitStart': case 'checking': case 'pay': case 'waitPay': case 'finalise': case 'waitFinalise': return 2
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

function Chat({ messages, recs, onGrok, me, name, members, polls, onSeeFindings }: {
  messages: S.Message[]; recs: S.Recommendation[]; onGrok: (rec: S.Recommendation) => void; me: string; name: (id: string) => string; members: S.Member[]
  polls: S.Poll[]; pact: S.Pact; iCoordinate: boolean; onVoted: () => void; onAddedToPlan: () => void; onSeeFindings: () => void
}) {
  const end = useRef<HTMLDivElement>(null)
  const seen = useRef<number | null>(null)
  // Opening a pact starts at the top. Only a new message scrolls down.
  useEffect(() => {
    if (seen.current !== null && messages.length > seen.current) end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    if (messages.length) seen.current = messages.length
  }, [messages.length])
  type Entry = { kind: 'message'; at: string; m: S.Message } | { kind: 'grok'; at: string; rec: S.Recommendation } | { kind: 'poll'; at: string; poll: S.Poll }
  const entries: Entry[] = [
    ...messages.map((m) => ({ kind: 'message' as const, at: m.created_at, m })),
    ...recs.map((rec) => ({ kind: 'grok' as const, at: rec.created_at, rec })),
    ...polls.map((poll) => ({ kind: 'poll' as const, at: poll.created_at, poll })),
  ].sort((x, y) => x.at.localeCompare(y.at))
  if (!entries.length) return <p className="l-chat-empty">Say hi to the group. Talk through what to book, and Pact Pilot will write it up when you're ready.</p>
  return (
    <div className="l-chat">
      {entries.map((e, i) => {
        const prev = entries[i - 1]
        const day = new Date(e.at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        const newDay = !prev || new Date(prev.at).toDateString() !== new Date(e.at).toDateString()
        const divider = newDay && <div className="l-chat-day" key={`d${i}`}><span>{day}</span></div>
        if (e.kind === 'grok') return [divider, <GrokBlock key={e.rec.recommendation_id} rec={e.rec} onOpen={onGrok} />]
        if (e.kind === 'poll') return [divider, <FoundSummary key={e.poll.poll_id} found={e.poll} votes={Object.keys(e.poll.votes).length} onOpen={onSeeFindings} />]
        const m = e.m
        const found = S.parseOptions(m.body)
        if (found) return [divider, <FoundSummary key={m.message_id} found={found} onOpen={onSeeFindings} />]
        const mine = m.sender_id === me
        const first = newDay || prev?.kind !== 'message' || prev.m.sender_id !== m.sender_id
        const who = members.find((x) => x.user_id === m.sender_id)
        return [divider, (
          <div key={m.message_id} className={mine ? 'l-msg me' : 'l-msg'}>
            {!mine && (first ? <Avatar name={who?.name} url={who?.avatar_url} size={44} /> : <span style={{ width: 44, flex: "none" }} />)}
            <div className="l-bubble">{!mine && first && <small>{S.firstName(name(m.sender_id))}</small>}<Linkified text={m.body} /></div>
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

/** Pact Pilot, one to one: preset prompts, your questions and its answers, and voice (speak, and hear it answer).
 *  Its changes still need your Approve, and its status updates still show in Pact Chat. */
const PILOT_PRESETS: { label: string; ask?: string; fill?: string; summary?: boolean }[] = [
  { label: 'Sum up the chat', summary: true },
  { label: "What's still missing?", ask: 'What does this pact still need decided before we can book?' },
  { label: 'Who owes what?', ask: 'Who owes what on the tab, and what are the fewest paybacks to square up?' },
  { label: "What's waiting on us?", ask: 'Who is this pact waiting on right now, and for what?' },
  { label: 'Find stays in budget', ask: 'Find 3 real places to stay that fit our dates and budget each, and put them to a vote.' },
  { label: 'Split a cost', fill: 'I paid $ for  , split with everyone' },
]

function PilotPanel({ id, me, pact, d, queued, onChanged, onOpenChat }: {
  id: string; me: string; pact: S.Pact | null; d: S.PactData; queued?: { q: string; n: number } | null; onChanged: () => void; onOpenChat: () => void
}) {
  const members = d.members
  const [text, setText] = useState('')
  const [log, setLog] = useState<{ key: number; question: string; summary: boolean; answer: S.PilotAnswer | null; error: string | null; old?: boolean }[]>([])
  const [voiceOn, setVoiceOn] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const voice = useDictation(setText)
  const box = useRef<HTMLTextAreaElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [log])
  // Your saved conversation with Pact Pilot in this pact comes back when you open the panel.
  useEffect(() => {
    let live = true
    void S.loadPilotHistory(id).then((turns) => {
      if (!live || !turns.length) return
      const past = turns.map((t, i) => ({ key: -(turns.length - i), question: t.question === S.summaryQuestion ? 'Sum up the chat' : t.question, summary: t.question === S.summaryQuestion, answer: t.answer, error: null, old: true }))
      setLog((l) => [...past, ...l.filter((x) => !x.old)])
    })
    return () => { live = false }
  }, [id])
  const clear = async () => {
    try { await S.clearPilotHistory(id); setLog([]) } catch (e) { setVoiceError((e as Error).message) }
  }
  // A question sent from Pact Chat with @Pilot: ask it here once.
  const askedFrom = useRef(0)
  useEffect(() => { if (queued && queued.n !== askedFrom.current) { askedFrom.current = queued.n; void ask(queued.q) } }, [queued]) // eslint-disable-line react-hooks/exhaustive-deps

  async function say(reply: string) {
    if (!voiceOn || !reply) return
    try {
      const clip = await S.speak(reply)
      audio.current?.pause()
      const a = new Audio(URL.createObjectURL(clip))
      audio.current = a
      await a.play()
    } catch (e) { setVoiceError((e as Error).message) }
  }
  /** Ask Pact Pilot. `shown` is what your bubble says, when the question sent is longer than what you tapped. */
  async function ask(question: string, shown?: string) {
    const q = question.trim()
    if (!q) return
    voice.stop(); setText(''); setVoiceError(null)
    const key = Date.now()
    setLog((l) => [...l, { key, question: shown ?? (q === S.summaryQuestion ? 'Sum up the chat' : q), summary: q === S.summaryQuestion, answer: null, error: null }])
    try {
      const answer = await S.askGrok(id, q)
      setLog((l) => l.map((x) => (x.key === key ? { ...x, answer } : x)))
      void say(answer.reply)
    } catch (e) {
      setLog((l) => l.map((x) => (x.key === key ? { ...x, error: (e as Error).message || "Pact Pilot couldn't answer. Try again." } : x)))
    }
  }
  const pick = (p: (typeof PILOT_PRESETS)[number]) => {
    if (p.summary) return void ask(S.summaryQuestion)
    if (p.fill) { setText(p.fill); requestAnimationFrame(() => box.current?.focus()); return }
    if (p.ask) void ask(p.ask)
  }
  return (
    <div className="l-pilot-panel">
      <div className="l-pilot-log">
        {!log.length && (
          <div className="l-pilot-hello">
            <span className="l-waiting-grok"><Grok size={18} /></span>
            <b>Ask Pact Pilot anything about this pact</b>
            <span className="l-dim">Only you see this conversation. Anything it changes waits for your Approve, and the group sees its updates in Pact Chat.</span>
          </div>
        )}
        {log.some((x) => x.old) && (
          <div className="l-pilot-history">
            <span>Earlier with Pact Pilot · only you see this</span>
            <button type="button" className="l-link-btn" onClick={() => void clear()}>Clear</button>
          </div>
        )}
        {log.map((x) => (
          <div key={x.key} className="l-pilot-turn">
            <div className="l-pilot-q">{x.question}</div>
            <div className="l-grok-ask">
              <div className="l-grok-ask-head"><span className="l-waiting-grok"><Grok size={15} /></span><b>Pact Pilot</b>
                {x.answer && <button className="l-x" type="button" title="Read it aloud" aria-label="Read it aloud" onClick={() => { const was = voiceOn; setVoiceOn(true); void (async () => { try { const clip = await S.speak(x.answer!.reply); audio.current?.pause(); const a = new Audio(URL.createObjectURL(clip)); audio.current = a; await a.play() } catch (e) { setVoiceError((e as Error).message) } setVoiceOn(was) })() }}><Icon name="wave" size={15} /></button>}
              </div>
              {x.answer && x.summary && <PactStats pact={pact} d={d} />}
              {x.answer ? <PilotAnswerView id={id} me={me} members={members} answer={x.answer} onDone={onChanged} onDismiss={() => setLog((l) => l.filter((y) => y.key !== x.key))} />
                : x.error ? <p className="l-error">{x.error}</p>
                : <div className="l-grok-ask-busy"><span>Pact Pilot is thinking</span><span className="l-dots"><i /><i /><i /></span></div>}
            </div>
            {x.answer && x.key === log[log.length - 1].key && <NextUp id={id} me={me} pact={pact} d={d} onAsk={(q) => void ask(q)} onOpenChat={onOpenChat} />}
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="l-pilot-presets">
        {PILOT_PRESETS.map((p) => <button key={p.label} type="button" className="l-pill" onClick={() => pick(p)}>{p.label}</button>)}
      </div>
      {(voice.failure || voiceError) && <p className="l-error">{voice.failure ?? voiceError}</p>}
      <form className="l-composer grok" onSubmit={(e) => { e.preventDefault(); void ask(text) }}>
        <textarea ref={box} rows={1} value={text} placeholder={voice.listening ? 'Listening… speak now' : 'Ask Pact Pilot'} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(text) } }} />
        <button type="button" className={voice.listening ? 'l-icon-btn l-mic on' : 'l-icon-btn l-mic'}
          onClick={() => { if (voice.listening) { voice.stop(); void ask(text) } else { setVoiceOn(true); void voice.start(text) } }}
          aria-label={voice.listening ? 'Stop and ask' : 'Talk to Pact Pilot'} title={voice.listening ? 'Stop and ask' : 'Talk to Pact Pilot'}>
          <Icon name={voice.listening ? 'wave' : 'mic'} />
        </button>
        <button type="submit" className="l-send" disabled={!text.trim()} aria-label="Ask Pact Pilot"><Icon name="up" /></button>
      </form>
    </div>
  )
}

/** The pact's key numbers at a glance, above a summary. */
function PactStats({ pact, d }: { pact: S.Pact | null; d: S.PactData }) {
  const when = pact ? S.dateRange(pact.starts_on, pact.ends_on) : null
  const stats = [
    { label: 'Where', value: pact?.location },
    { label: 'When', value: when },
    { label: 'Budget', value: pact?.budget != null ? `${S.dollars(pact.budget)} each` : null },
    { label: 'Going', value: `${d.members.length} ${d.members.length === 1 ? 'person' : 'people'}` },
  ].filter((x): x is { label: string; value: string } => Boolean(x.value))
  return (
    <div className="l-pilot-stats">
      {stats.map((x) => <div key={x.label}><span>{x.label}</span><b>{x.value}</b></div>)}
    </div>
  )
}

/** What to do next, from the pact itself: who it's waiting on, with a button for it. */
function NextUp({ id, me, pact, d, onAsk, onOpenChat }: {
  id: string; me: string; pact: S.Pact | null; d: S.PactData; onAsk: (q: string) => void; onOpenChat: () => void
}) {
  const [sent, setSent] = useState<string | null>(null)
  const w = S.waitingOn(d)
  const name = (u: string) => (u === me ? 'You' : S.firstName(d.members.find((m) => m.user_id === u)?.name))
  const doing = w && {
    approve: 'approve the plan',
    start: 'set up the split and start collecting',
    pay: w.amount != null ? `pay ${S.dollars(w.amount)}` : 'pay their share',
    release: 'release the money and book it',
  }[w.what]
  const items: { key: string; text: string; button?: { label: string; run: () => void } }[] = []
  if (w && doing) {
    for (const u of w.people) {
      if (u === me) items.push({ key: u, text: `You need to ${doing}`, button: { label: 'Do it', run: onOpenChat } })
      else {
        const who = name(u)
        items.push({ key: u, text: `${who} needs to ${doing}`, button: { label: sent === u ? 'Nudged' : `Nudge ${who}`, run: () => {
          if (sent === u) return
          setSent(u)
          void S.send(id, `${who}, the pact is waiting on you to ${doing}.`).catch(() => setSent(null))
        } } })
      }
    }
  }
  if (!d.recommendations.length && !d.plan) items.push({ key: 'stays', text: 'No places to stay yet', button: { label: 'Find stays', run: () => onAsk('Find 3 real places to stay that fit our dates and budget each, and put them to a vote.') } })
  if (pact && !pact.starts_on) items.push({ key: 'dates', text: 'No dates set yet', button: { label: 'Pick dates', run: () => onAsk('Start a vote on the dates for this trip.') } })
  if (!items.length) return null
  return (
    <div className="l-pilot-next">
      <span className="l-pilot-next-title">Next up</span>
      {items.map((x) => (
        <div key={x.key} className="l-pilot-next-row">
          <span>{x.text}</span>
          {x.button && <button type="button" className="l-btn l-small" disabled={x.button.label === 'Nudged'} onClick={x.button.run}>{x.button.label}</button>}
        </div>
      ))}
    </div>
  )
}

// @Pilot asks Pact Pilot. @Grok (its old name) still works.
const AT_GROK = /(^|\s)@(pilot|grok)\b[:,]?/i

function Composer({ id, onAskGrok }: { id: string; onAskGrok: (question: string) => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const voice = useDictation(setText)
  async function submit() {
    const body = text.trim()
    if (!body) return
    voice.stop()
    setText('')
    // Pact Chat is for the group. A message to @Pilot goes to Pact Pilot instead of the group.
    if (AT_GROK.test(body)) { onAskGrok(body.replace(AT_GROK, ' ').replace(/\s+/g, ' ').trim() || 'What should we do next?'); return }
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
      <div className="l-person"><span className="l-av" style={{ width: 30, height: 30, background: '#000' }}><Grok size={16} /></span><b>Pact Pilot</b><small>Planner</small></div>
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
      <p className="l-side-note" style={{ margin: '14px 0 0' }}>Anyone can add people. Only the coordinator can remove them{d.plan ? ', and not once the split is set up' : ''}.</p>
    </Modal>
  )
}

const placeholders: Record<S.ItemKind, string> = { stay: 'South Congress house', flight: 'Austin to San Antonio', ticket: 'Blockchain summit passes', dinner: 'Team dinner', other: 'Anything else' }

function AddItem({ pact, messages, name, extra = false, onClose }: { pact: S.Pact; messages: S.Message[]; name: (id: string) => string; extra?: boolean; onClose: () => void }) {
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
    <Modal title={extra ? 'Add an extra' : 'Add item'} onClose={onClose}>
      {extra && <p className="l-dim" style={{ margin: '0 0 12px' }}>The split is set up, so this goes in as an extra. The group approves extras, then everyone pays the coordinator their share.</p>}
      <form className="l-form" onSubmit={(e) => { e.preventDefault(); if (draft.title.trim()) void go('add', () => S.addItem(pact.pact_id, draft, 'manual', extra)) }}>
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
          {working === 'grok' ? <Busy text="Pact Pilot is reading the chat…" /> : <><img src="/grok.svg" alt="" width={16} />Add from the chat with Pact Pilot</>}
        </button>
      </form>
    </Modal>
  )
}

/** One Pact Pilot write-up, spaced out: what it said, what it picked, and the next steps. */
function Summary({ rec, booking, onBooking, onClose }: { rec: S.Recommendation; booking: S.Booking | null; onBooking: (b: S.Booking) => void; onClose: () => void }) {
  const when = new Date(rec.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const pick = rec.options[0]
  return (
    <Modal title={<span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}><Grok size={26} />Pact Pilot</span>} onClose={onClose}>
      <div className="l-sum-block">
        <small>{when}</small>
        {rec.summary.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}
        {pick && (
          <div className="l-sum-pick">
            <span className="l-sum-pick-label">Pact Pilot picked</span>
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

/** A Pact Pilot write-up in the chat. The first, big setup is shown large at the top; each later question gets its own block. */
function GrokBlock({ rec, big, onOpen }: { rec: S.Recommendation; big?: boolean; onOpen: (rec: S.Recommendation) => void }) {
  const pick = rec.options[0]
  const when = new Date(rec.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return (
    <button type="button" className={big ? 'l-grok-block big' : 'l-grok-block'} onClick={() => onOpen(rec)}>
      <span className="l-av l-grok-av" style={{ width: big ? 48 : 40, height: big ? 48 : 40 }}><Grok size={big ? 26 : 22} /></span>
      <span className="l-grok-block-main">
        <b>{big ? 'Pact Pilot set up this pact' : pick ? `Pact Pilot: ${pick.title}` : 'Pact Pilot wrote a plan'}</b>
        <small>{when}</small>
      </span>
      <span className="l-grok-one-open">Open</span>
    </button>
  )
}

/** Pact Pilot at work, at the bottom of the chat: thinking, taking longer, or failed with a way to try again. */
/** Pact Pilot's live line at the bottom of the chat: who the pact is waiting on, with their faces. If it's you, your button. */
function WaitingCard({ d, me, step, hasGrok, working, onAct }: {
  d: S.PactData; me: string; step: S.Step; hasGrok: boolean; working: string | null; onAct: () => void
}) {
  const w = S.waitingOn(d)
  if (!w || !w.people.length) return null
  const people = w.people.map((u) => d.members.find((m) => m.user_id === u)).filter((m): m is S.Member => Boolean(m))
  const names = people.map((m) => (m.user_id === me ? 'you' : S.firstName(m.name)))
  const list = names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  const doing = {
    approve: 'to approve the plan',
    start: 'to set up the split and start collecting',
    pay: w.amount != null ? `to pay their ${S.dollars(w.amount)} share` : 'to pay their share',
    release: 'to release the money and book it',
  }[w.what]
  const mine = w.people.includes(me)
  const label = S.stepLabel(step, hasGrok)
  const pin = w.what === 'pay' || w.what === 'release'
  return (
    <div className={`l-waiting${mine ? ' mine' : ''}`} role="status">
      <span className="l-waiting-grok"><Grok size={15} /></span>
      <div className="l-waiting-main">
        <b>Pact Pilot</b>
        <span>Waiting on {list} {doing}.{mine && pin ? ' You confirm it with your PIN.' : ''}</span>
        <div className="l-waiting-faces">
          {people.slice(0, 6).map((m) => <Avatar key={m.user_id} name={m.name} url={m.avatar_url} size={26} />)}
          {mine && label.action && <button className="l-btn l-small" type="button" disabled={Boolean(working)} onClick={onAct}>{label.text}</button>}
        </div>
      </div>
    </div>
  )
}

function GrokStatus({ job, onDismiss }: { job: { label: string; slow: boolean; error: string | null; retry: () => void }; onDismiss: () => void }) {
  return (
    <div className={job.error ? 'l-grok-status error' : 'l-grok-status'}>
      <span className="l-av l-grok-av" style={{ width: 40, height: 40 }}><Grok size={22} /></span>
      <div className="l-grok-status-main">
        {job.error ? <><b>Pact Pilot couldn't answer</b><span>{job.error}</span></>
          : <><b>{job.slow ? 'Pact Pilot is taking longer than usual…' : job.label}</b><span className="l-dots"><i /><i /><i /></span></>}
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
    <Modal title={<span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}><Grok size={26} />Pact Pilot</span>} onClose={onClose}>
      <p className="l-dim" style={{ marginTop: 0 }}>Your pact's planner</p>
      {line('text', 'Reads the group chat', 'When you tap Set up with Grok, it reads what everyone said.')}
      {line('list', 'Writes up the booking', 'The one thing you agreed on, its link, and the price for each person.')}
      {line('checkCircle', 'Never touches money', "Everyone approves their own share. Pact Pilot can't pay or book on its own.")}
      <p className="l-dim" style={{ fontSize: 14 }}>Connected through Pact. Nothing to set up.</p>
      <a className="l-btn l-ghost l-wide-btn" href="https://grok.com" target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>Open your own Grok<Icon name="link" size={15} /></a>
    </Modal>
  )
}

function Person({ member, onSend, onClose }: { member: S.Member; onSend: () => void; onClose: () => void }) {
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
        {!mine && <button className="l-btn" type="button" style={{ marginTop: 6 }} onClick={onSend}><Icon name="up" size={16} />Send money</button>}
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
  // Collecting already started (on another device, or before this page refreshed): say so, nothing to do here.
  const alreadyOpen = action === 'create_pact' && chain != null && chain.state !== 'none'
  const shown = alreadyOpen
    ? { title: 'Collecting has started', text: `The split is already open, so everyone can pay their ${S.dollars(share)} share now. There's nothing else to do here.`, button: '' }
    : copy
  return (
    <Modal title={shown.title} onClose={onClose}>
      <p className="l-dim" style={{ marginTop: 0, lineHeight: 1.5 }}>{shown.text}</p>
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
        {state === 'done' || alreadyOpen ? <button className="l-btn l-wide-btn" type="button" onClick={() => { void refreshPact(id); onClose() }}>Done</button>
          : state === 'busy' ? <Busy text="Confirm with your PIN, then Arc confirms it…" />
          : <button className="l-btn l-wide-btn" type="button" disabled={action !== 'pay_share' && !iCoordinate}
              onClick={async () => { setState('busy'); setError(null); try { await S.pactAction(action, id); await refreshPact(id); setWallet(await S.loadWallet()); setState('done') } catch (e) { const msg = (e as Error).message ?? ''; if (/already (on chain|started|open)/i.test(msg)) { await refreshPact(id); setState('done'); return } setError(msg || "That didn't go through. Try again."); setState('idle') } }}>{copy.button}</button>}
      </div>
    </Modal>
  )
}

/** Send USDC to someone in the pact by who they are, not their address. Confirmed with my PIN, and a note goes in the
 *  chat. From Settle it's a payback (it counts on the tab); from Send money it's a plain send. */
/** Extras: things added after the split was locked. The group approves a round, then each person pays the
 *  coordinator their share with their PIN. The first split stays as it is. */
function ExtrasCard({ extras, me, members, working, onAdd, onSend, onVote, onPay }: {
  extras: S.Extras; me: string; members: S.Member[]; working: string | null
  onAdd: () => void; onSend: () => void; onVote: (roundId: string, yes: boolean) => void; onPay: (roundId: string, cents: number) => void
}) {
  const host = members.find((m) => m.user_id === extras.host)
  const hostName = extras.host === me ? 'you' : S.firstName(host?.name)
  const unsentEach = extras.unsent.reduce((n, i) => n + (i.price_each ?? 0), 0)
  const open = extras.rounds.find((r) => r.status === 'open')
  return (
    <div className="l-about l-extras">
      <div className="l-extras-head">
        <div className="l-section-title">Extras</div>
        <button className="l-pill" type="button" onClick={onAdd}><Icon name="plus" />Add an extra</button>
      </div>
      {!extras.unsent.length && !extras.rounds.length && (
        <p className="l-dim" style={{ margin: 0 }}>The split is set up, so the plan is locked. Anything else (a taxi, a dinner) goes here as an extra: the group approves it, then everyone pays {hostName} their share.</p>
      )}
      {extras.unsent.length > 0 && (
        <div className="l-extras-round">
          {extras.unsent.map((i) => <div key={i.item_id ?? i.title} className="l-extras-item"><span>{i.title}</span><b>{i.price_each != null ? `${S.dollars(i.price_each)} each` : 'No price'}</b></div>)}
          <div className="l-extras-foot">
            <span className="l-dim">Not sent yet · {S.dollars(unsentEach)} each</span>
            <button className="l-btn l-small" type="button" disabled={Boolean(working) || Boolean(open) || unsentEach <= 0} onClick={onSend}
              title={open ? 'Finish the extras already up for approval first' : undefined}>Send extras for approval</button>
          </div>
        </div>
      )}
      {extras.rounds.map((r) => {
        const each = r.share_cents
        const myVote = r.votes[me]
        const approvals = Object.values(r.votes).filter((v) => v === 'approve').length
        const iPaid = r.paid.includes(me) || extras.host === me
        const payers = members.filter((m) => m.user_id !== extras.host)
        const paidCount = payers.filter((m) => r.paid.includes(m.user_id)).length
        return (
          <div key={r.round_id} className="l-extras-round">
            <div className="l-extras-title"><b>{S.cents(each)} each</b><span className={`l-chip-status ${r.status}`}>{r.status === 'open' ? 'Approving' : paidCount >= payers.length ? 'All paid' : 'Paying'}</span></div>
            {r.items.map((i, k) => <div key={k} className="l-extras-item"><span>{i.title}</span><b>{i.price_each != null ? `${S.dollars(i.price_each)} each` : ''}</b></div>)}
            {r.status === 'open' ? (
              <div className="l-extras-foot">
                <span className="l-dim">Approved by {approvals} of {members.length}</span>
                {!myVote && <div className="l-extras-buttons">
                  <button className="l-btn l-ghost l-small" type="button" disabled={Boolean(working)} onClick={() => onVote(r.round_id, false)}>Not yet</button>
                  <button className="l-btn l-small" type="button" disabled={Boolean(working)} onClick={() => onVote(r.round_id, true)}>Approve</button>
                </div>}
              </div>
            ) : (
              <div className="l-extras-foot">
                <span className="l-dim">{paidCount} of {payers.length} paid {hostName}</span>
                {!iPaid && <button className="l-btn l-small" type="button" disabled={Boolean(working)} onClick={() => onPay(r.round_id, each)}>Pay {S.cents(each)} to {hostName}</button>}
                {iPaid && extras.host !== me && <span className="l-net owed">Paid</span>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function SendMoney({ id, d, initial, cents: preset, payback, extras, onClose, onSent }: {
  id: string; d: S.PactData; initial: string | null; cents?: number; payback?: boolean; extras?: string; onClose: () => void; onSent: () => void
}) {
  const { me, wallet, go, setWallet } = useApp()
  const people = d.members.filter((m) => m.user_id !== me)
  const [to, setTo] = useState<string | null>(initial ?? (people.length === 1 ? people[0].user_id : null))
  const [amount, setAmount] = useState(preset ? (preset / 100).toFixed(2) : '')
  const [note, setNote] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const who = people.find((m) => m.user_id === to)
  const typed = S.toCents(amount)
  const cents = Number.isFinite(typed) && typed > 0 ? typed : 0
  const balance = wallet?.usdcBalance != null ? Number(wallet.usdcBalance.replace(/,/g, '')) : null
  const tooMuch = balance != null && cents / 100 > balance

  async function send() {
    if (!who) return
    setState('busy'); setError(null)
    try {
      await (extras ? S.payExtras(id, extras, who.user_id, cents) : payback ? S.payBack(id, who.user_id, cents) : S.sendTo(id, who.user_id, cents))
      const what = note.trim() ? ` for ${note.trim()}` : extras ? ' for the extras' : payback ? ' to settle up' : ''
      await S.send(id, `Sent ${S.cents(cents)} to ${S.firstName(who.name)}${what}.`).catch(() => undefined)
      setWallet(await S.loadWallet())
      onSent()
      setState('done')
    } catch (e) { setError((e as Error).message || "That didn't go through."); setState('idle') }
  }

  return (
    <Modal title={state === 'done' ? 'Sent' : payback ? 'Settle up' : 'Send money'} onClose={onClose}>
      {!wallet ? (
        <div className="l-compact l-small-form">
          <p className="l-dim" style={{ margin: 0 }}>Make your wallet first. Then you can send money to anyone in this pact.</p>
          <button className="l-btn l-wide-btn" type="button" onClick={() => { onClose(); go('/wallet') }}>Go to wallet</button>
        </div>
      ) : state === 'done' && who ? (
        <div className="l-compact l-small-form l-send-done">
          <Avatar name={who.name} url={who.avatar_url} size={56} />
          <b>{S.cents(cents)} to {S.firstName(who.name)}</b>
          <span className="l-dim">{payback ? "It's in their Pact wallet, and the tab is settled." : "It's in their Pact wallet."}</span>
          <button className="l-btn l-wide-btn" type="button" onClick={onClose}>Done</button>
        </div>
      ) : (
        <form className="l-compact l-small-form" onSubmit={(e) => { e.preventDefault(); if (who && cents > 0 && !tooMuch) void send() }}>
          <span className="l-field-label">To</span>
          <div className="l-quick l-people-pick" role="radiogroup" aria-label="Send to">
            {people.map((m) => (
              <button key={m.user_id} type="button" role="radio" aria-checked={to === m.user_id} className={to === m.user_id ? 'on' : ''} disabled={state === 'busy'} onClick={() => setTo(m.user_id)}>
                <Avatar name={m.name} url={m.avatar_url} size={24} /><span>{S.firstName(m.name)}</span>
              </button>
            ))}
            {!people.length && <span className="l-dim">Add people to this pact first.</span>}
          </div>
          <span className="l-field-label">Amount</span>
          <label className="l-money-field"><span>$</span>
            <input inputMode="decimal" autoFocus placeholder="0.00" value={amount} disabled={state === 'busy'} aria-label="Amount in dollars"
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} /><small>USDC</small></label>
          <span className={tooMuch ? 'l-error l-field-hint' : 'l-dim l-field-hint'}>{balance == null ? 'From your Pact wallet' : tooMuch ? `You have ${S.dollars(balance)} in your wallet` : `${S.dollars(balance)} available`}</span>
          <label className="l-money-field"><Icon name="text" size={16} />
            <input placeholder="What's it for? (optional)" value={note} maxLength={80} disabled={state === 'busy'} onChange={(e) => setNote(e.target.value)} /></label>
          {error && <p className="l-error">{error}</p>}
          {state === 'busy' ? <Busy text="Confirm with your PIN, then it sends…" />
            : <button className="l-btn l-wide-btn" type="submit" disabled={!who || cents <= 0 || tooMuch}>
                {who && cents > 0 ? `Send ${S.cents(cents)} to ${S.firstName(who.name)}` : 'Send'}
              </button>}
        </form>
      )}
    </Modal>
  )
}

/** On the right of someone in the people list: the net between us on the tab. $0.00 until money moves; green when
 *  they owe me, red when I owe them (tap it to settle). */
function NetBalance({ who, me, tab, onSettle }: { who: S.Member; me: string; tab: S.Tab | null; onSettle: (cents: number) => void }) {
  const iOwe = tab ? tab.settle_up.filter((p) => p.from === me && p.to === who.user_id).reduce((n, p) => n + p.amount_cents, 0) : 0
  const theyOwe = tab ? tab.settle_up.filter((p) => p.from === who.user_id && p.to === me).reduce((n, p) => n + p.amount_cents, 0) : 0
  const net = theyOwe - iOwe
  if (net < 0) return <button className="l-net owe" type="button" onClick={() => onSettle(-net)} title={`You owe ${S.firstName(who.name)} ${S.cents(net)}. Tap to settle.`}>−{S.cents(net)}</button>
  return <span className={net > 0 ? 'l-net owed' : 'l-net'} title={net > 0 ? `${S.firstName(who.name)} owes you ${S.cents(net)}` : 'Nothing owed either way'}>{net > 0 ? '+' : ''}{S.cents(net)}</span>
}

/** While the pact is collecting: each person's share, minus until they pay, then $0.00 in green. */
function shareBalance(d: S.PactData | null, userId: string, me: string) {
  const chain = d?.chain
  if (!chain || chain.state !== 'open') return null
  const row = chain.members.find((m) => m.userId === userId)
  if (!row) return null
  const share = Math.round(Number(chain.share.usdc) * 100)
  const who = userId === me ? 'You' : S.firstName(d.members.find((m) => m.user_id === userId)?.name)
  return row.paid
    ? <span className="l-net owed" title={`${who} paid ${userId === me ? 'your' : 'their'} share`}>{S.cents(0)}</span>
    : <span className="l-net owe" title={`${who} still ${userId === me ? 'owe' : 'owes'} ${S.cents(share)}`}>−{S.cents(share)}</span>
}

/** My own row: where I stand with the whole group on this pact's tab. Green when I'm owed, red when I owe. */
function MyBalance({ me, tab }: { me: string; tab: S.Tab | null }) {
  const cents = tab?.members.find((m) => m.user_id === me)?.balance_cents ?? 0
  const title = cents > 0 ? `The group owes you ${S.cents(cents)}` : cents < 0 ? `You owe the group ${S.cents(cents)}` : "You're square with everyone"
  return <span className={cents > 0 ? 'l-net owed' : cents < 0 ? 'l-net owe' : 'l-net'} title={title}>{cents > 0 ? '+' : cents < 0 ? '−' : ''}{S.cents(cents)}</span>
}

/** About this pact, its link, and a way into Settings. */
function InfoSheet({ pact, canEdit, onSettings, onClose }: { pact: S.Pact; canEdit: boolean; onSettings: () => void; onClose: () => void }) {
  const details = S.detailsOf(pact)
  return (
    <Modal title="Info" onClose={onClose}>
      <div className="l-compact l-small-form">
        <span className="l-field-label">About</span>
        <p style={{ margin: 0 }}>{details.about || <span className="l-dim">Nothing written yet.</span>}</p>
        {pact.link && <><span className="l-field-label">Link</span><a className="l-link-line" href={pact.link} target="_blank" rel="noreferrer">{siteOf(pact.link)}</a></>}
        {canEdit && <button className="l-btn l-ghost l-wide-btn" type="button" onClick={onSettings}><Icon name="gear" size={16} />Edit in Settings</button>}
      </div>
    </Modal>
  )
}

const siteOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }

/** Plain text with links shown as their site name ("hilton.com ↗") instead of a long raw URL. */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g)
  return <>{parts.map((part, i) => /^https?:\/\//.test(part)
    ? <a key={i} className="l-inline-link" href={part} target="_blank" rel="noreferrer">{siteOf(part)} ↗</a>
    : <span key={i}>{part}</span>)}</>
}

/** The picture for an option: its own image if it has one, otherwise the site's logo on a soft tile. */
function OptionImage({ option }: { option: S.PollOption }) {
  const [broken, setBroken] = useState(false)
  const site = option.link ? siteOf(option.link) : null
  const src = option.image && /^https:\/\//.test(option.image) ? option.image : site ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(site)}&sz=128` : null
  return (
    <div className={option.image && !broken ? 'l-opt-img photo' : 'l-opt-img'}>
      {src && !broken ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : <span>{option.name.slice(0, 1).toUpperCase()}</span>}
      {site && <small>{site}</small>}
    </div>
  )
}

/** A grid of options as cards: picture, name, price each, a short note and the link. Voting and approving are passed in. */
function OptionGrid({ options, title, compact, renderFoot }: {
  options: S.PollOption[]; title?: string; compact?: boolean; renderFoot?: (o: S.PollOption) => ReactNode
}) {
  return (
    <div className={compact ? 'l-opt-grid compact' : 'l-opt-grid'}>
      {title && <b className="l-opt-title">{title}</b>}
      <div className="l-opt-cards">
        {options.map((o) => (
          <div key={o.key} className="l-opt-card">
            <OptionImage option={o} />
            <div className="l-opt-body">
              <b className="l-opt-name">{o.name}</b>
              {o.price_each != null && <div className="l-opt-price">{S.dollars(o.price_each)}<small> each</small></div>}
              {o.notes && !compact && <p className="l-opt-notes">{o.notes}</p>}
              {o.link && <a className="l-inline-link" href={o.link} target="_blank" rel="noreferrer">{siteOf(o.link)} ↗</a>}
            </div>
            {renderFoot?.(o)}
          </div>
        ))}
      </div>
    </div>
  )
}

/** A vote: the options as cards, tap Vote on one (tap again to take it back), live counts and faces, and Approve for
 *  the coordinator on the one that's ahead. */
function PollCard({ poll, me, members, pact, iCoordinate, onVoted, onAddedToPlan }: {
  poll: S.Poll; me: string; members: S.Member[]; pact: S.Pact; iCoordinate: boolean; onVoted: () => void; onAddedToPlan: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mineNow, setMineNow] = useState<string | null | undefined>(undefined) // my tap shows straight away
  const votes = { ...poll.votes }
  if (mineNow !== undefined) { if (mineNow) votes[me] = mineNow; else delete votes[me] }
  const total = Object.keys(votes).length
  const count = (key: string) => Object.values(votes).filter((v) => v === key).length
  const top = Math.max(0, ...poll.options.map((o) => count(o.key)))
  const open = poll.status === 'open'
  async function vote(key: string) {
    setBusy(key); setError(null); setMineNow(votes[me] === key ? null : key)
    try { await S.votePoll(poll.poll_id, key); onVoted() } catch (e) { setError((e as Error).message); setMineNow(undefined) }
    setBusy(null)
  }
  async function approve(option: S.PollOption) {
    setBusy(option.key); setError(null)
    try { await S.addPollPickToPlan(pact, poll, option); onAddedToPlan() } catch (e) { setError((e as Error).message) }
    setBusy(null)
  }
  return (
    <div className="l-poll">
      <div className="l-poll-head">
        {poll.source === 'grok' && <span className="l-av" style={{ width: 28, height: 28, background: '#000' }}><Grok size={15} /></span>}
        <div><b>{poll.title}</b><span>{open ? `${total} of ${members.length} voted` : 'Decided'}</span></div>
      </div>
      <OptionGrid options={poll.options} renderFoot={(o) => {
        const n = count(o.key)
        const chosen = votes[me] === o.key
        const voters = members.filter((m) => votes[m.user_id] === o.key)
        const leading = n > 0 && n === top
        return (
          <div className={['l-opt-foot', chosen ? 'chosen' : '', leading ? 'leading' : ''].join(' ')}>
            <span className="l-opt-bar" style={{ width: total ? `${(n / total) * 100}%` : 0 }} aria-hidden />
            <span className="l-poll-faces">{voters.slice(0, 4).map((m) => <Avatar key={m.user_id} name={m.name} url={m.avatar_url} size={22} />)}</span>
            <span className="l-opt-count">{n} {n === 1 ? 'vote' : 'votes'}</span>
            {open && <VoteCheck on={chosen} disabled={Boolean(busy)} label={o.name} onClick={() => void vote(o.key)} />}
            {iCoordinate && open && leading && <button className="l-settle" type="button" disabled={Boolean(busy)} onClick={() => void approve(o)}>Approve</button>}
          </div>
        )
      }} />
      {error && <p className="l-error">{error}</p>}
    </div>
  )
}

/** Options Pact Pilot (or anyone) posted as a chat message, as cards. Tick one to vote: the first tick turns the list into a vote. */
function MessageOptions({ id, found, onStarted }: { id: string; found: NonNullable<ReturnType<typeof S.parseOptions>>; onStarted: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const kind = S.guessKind(`${found.title} ${found.options.map((o) => o.name).join(' ')}`)
  async function tick(key: string) {
    setBusy(key); setError(null)
    try { const pollId = await S.startPoll(id, found.title, found.options, kind); await S.votePoll(pollId, key); onStarted() } catch (e) { setError((e as Error).message) }
    setBusy(null)
  }
  return (
    <div className="l-poll">
      <div className="l-poll-head">
        <span className="l-av" style={{ width: 28, height: 28, background: '#000' }}><Grok size={15} /></span>
        <div><b>{found.title}</b><span>{found.options.length} options · tick the one you want</span></div>
      </div>
      <OptionGrid options={found.options.map((o, k) => ({ ...o, key: String(k + 1) }))} renderFoot={(o) => (
        <div className="l-opt-foot">
          <span className="l-opt-count">No votes yet</span>
          <VoteCheck on={busy === o.key} disabled={Boolean(busy)} label={o.name} onClick={() => void tick(o.key)} />
        </div>
      )} />
      {error && <p className="l-error">{error}</p>}
    </div>
  )
}

/** The round tick you tap to vote for an option. Filled silver once it's your pick. */
function VoteCheck({ on, disabled, label, onClick }: { on: boolean; disabled?: boolean; label: string; onClick: () => void }) {
  return (
    <button className={on ? 'l-vote-check on' : 'l-vote-check'} type="button" disabled={disabled} aria-pressed={on}
      aria-label={on ? `Take back your vote for ${label}` : `Vote for ${label}`} title={on ? 'Your vote · tap to take it back' : 'Vote for this'} onClick={onClick}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
    </button>
  )
}

/** In the chat: one line saying what Pact Pilot found, and a button to see and vote on it in Findings. */
function FoundSummary({ found, votes, onOpen }: { found: { title: string; options: { price_each: number | null }[] }; votes?: number; onOpen: () => void }) {
  const prices = found.options.map((o) => o.price_each).filter((p): p is number => p != null)
  const range = !prices.length ? null : Math.min(...prices) === Math.max(...prices) ? `${S.dollars(prices[0])} each` : `${S.dollars(Math.min(...prices))}–${S.dollars(Math.max(...prices))} each`
  return (
    <div className="l-found">
      <span className="l-av" style={{ width: 36, height: 36, background: '#000', flex: 'none' }}><Grok size={19} /></span>
      <div className="l-found-text">
        <b>{found.title}</b>
        <span>{found.options.length} options{range ? ` · ${range}` : ''}{votes ? ` · ${votes} voted` : ''}</span>
      </div>
      <button className="l-btn l-small" type="button" onClick={onOpen}>Check it out</button>
    </div>
  )
}

/** The ↗ arrow used for sending money. */
function ArrowNE({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 17L17 7M8 7h9v9" /></svg>
}

/** The pact's name. The coordinator taps it, or Edit on the right, and types right there: Enter saves, Esc or tapping away cancels. */
function PactTitle({ id, name, canEdit, editing, onEditing, onSaved }: {
  id: string; name: string; canEdit: boolean; editing: boolean; onEditing: (on: boolean) => void; onSaved: () => void
}) {
  const [text, setText] = useState(name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (!editing) setText(name) }, [name, editing])
  async function save() {
    const next = text.trim()
    if (!next || next === name) { onEditing(false); setError(null); return }
    setBusy(true); setError(null)
    try { await S.renamePact(id, next); onSaved(); onEditing(false) } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }
  return (
    <div className="l-title-row">
      {editing
        ? <input className="l-title l-title-inline" autoFocus value={text} maxLength={80} disabled={busy} aria-label="Pact name"
            onChange={(e) => setText(e.target.value)} onBlur={() => void save()}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save() } if (e.key === 'Escape') { setText(name); onEditing(false); setError(null) } }} />
        : <h1 className={canEdit ? 'l-title can-edit' : 'l-title'} onClick={canEdit ? () => onEditing(true) : undefined} title={canEdit ? 'Rename' : undefined}>{name}</h1>}
      {error && <p className="l-error l-title-error">{error}</p>}
    </div>
  )
}

/** A pill beside the title: the dates or the budget. The coordinator taps it to change it; everyone else just reads it. */
function TitleChip({ icon, label, empty, canEdit, hint, onClick }: { icon: string; label: string; empty: boolean; canEdit: boolean; hint: string; onClick: () => void }) {
  if (!canEdit && empty) return null
  const body = <><Icon name={icon} size={16} /><span>{label}</span></>
  return canEdit
    ? <button className={empty ? 'l-chip empty' : 'l-chip'} type="button" onClick={onClick} title={hint}>{body}</button>
    : <span className="l-chip" title={hint}>{body}</span>
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const fromIso = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }

/** Pick the trip's dates on a month calendar: tap the first day, then the last. One tap and Save makes it a single day. */
function DatesSheet({ pact, onClose, onSaved }: { pact: S.Pact; onClose: () => void; onSaved: () => void }) {
  const [start, setStart] = useState<string | null>(pact.starts_on)
  const [end, setEnd] = useState<string | null>(pact.ends_on ?? pact.starts_on)
  const first = start ? fromIso(start) : new Date()
  const [month, setMonth] = useState(new Date(first.getFullYear(), first.getMonth(), 1))
  const [hover, setHover] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const today = iso(new Date())
  const lead = (month.getDay() + 6) % 7 // weeks start on Monday
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => iso(new Date(month.getFullYear(), month.getMonth(), i + 1)))]
  const picking = Boolean(start && !end)
  const rangeEnd = picking && hover && start && hover >= start ? hover : end
  function pick(day: string) {
    if (!start || end || day < start) { setStart(day); setEnd(null) }
    else setEnd(day)
  }
  async function save(next: { startsOn: string | null; endsOn: string | null }) {
    setBusy(true); setError(null)
    try { await S.saveDetails(pact.pact_id, { ...S.detailsOf(pact), ...next }); onSaved() } catch (e) { setError((e as Error).message); setBusy(false) }
  }
  const label = start ? S.dateRange(start, end ?? start) : null
  return (
    <Modal title="When is it?" onClose={onClose}>
      <div className="l-cal l-compact">
        <div className="l-cal-head">
          <button className="l-icon-btn" type="button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><Icon name="back" /></button>
          <b>{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</b>
          <button className="l-icon-btn l-cal-next" type="button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><Icon name="back" /></button>
        </div>
        <div className="l-cal-grid" onMouseLeave={() => setHover(null)}>
          {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((w) => <span key={w} className="l-cal-week">{w}</span>)}
          {cells.map((day, i) => {
            if (!day) return <span key={`e${i}`} />
            const inRange = start && rangeEnd && day > start && day < rangeEnd
            const edge = day === start || day === (rangeEnd ?? start)
            return (
              <button key={day} type="button" className={['l-cal-day', inRange ? 'in' : '', edge ? 'edge' : '', day === today ? 'today' : '', day < today ? 'past' : ''].join(' ')}
                onClick={() => pick(day)} onMouseEnter={() => setHover(day)} aria-pressed={Boolean(edge)} aria-label={fromIso(day).toDateString()}>
                {fromIso(day).getDate()}
              </button>
            )
          })}
        </div>
        <p className="l-cal-pick">{!start ? 'Tap the first day.' : picking ? `${label} · now tap the last day, or Save for one day` : label}</p>
        {error && <p className="l-error">{error}</p>}
        <div className="l-cal-actions">
          {pact.starts_on && <button className="l-btn l-ghost" type="button" disabled={busy} onClick={() => void save({ startsOn: null, endsOn: null })}>Clear dates</button>}
          <button className="l-btn" type="button" disabled={busy || !start} onClick={() => void save({ startsOn: start, endsOn: end ?? start })}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </Modal>
  )
}

const BUDGETS = [100, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000]

/** Set the budget per person: tap a quick amount (scroll for more) or type one. */
function BudgetSheet({ pact, onClose, onSaved }: { pact: S.Pact; onClose: () => void; onSaved: () => void }) {
  const current = S.detailsOf(pact).budget
  const [amount, setAmount] = useState(current != null ? String(current) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const value = amount.trim() === '' ? null : Number(amount)
  const valid = value != null && Number.isFinite(value) && value > 0 && value <= 1_000_000
  async function save(budget: number | null) {
    setBusy(true); setError(null)
    try { await S.saveDetails(pact.pact_id, { ...S.detailsOf(pact), budget }); onSaved() } catch (e) { setError((e as Error).message); setBusy(false) }
  }
  return (
    <Modal title="Budget per person" onClose={onClose}>
      <form className="l-compact l-small-form" onSubmit={(e) => { e.preventDefault(); if (valid) void save(Math.round(value! * 100) / 100) }}>
        <div className="l-quick" role="list" aria-label="Quick amounts">
          {BUDGETS.map((n) => (
            <button key={n} type="button" role="listitem" className={value === n ? 'on' : ''} disabled={busy} onClick={() => setAmount(String(n))}>{S.dollars(n)}</button>
          ))}
        </div>
        <label className="l-money-field"><span>$</span>
          <input inputMode="decimal" autoFocus placeholder="Or type an amount" value={amount} disabled={busy} aria-label="Budget per person in dollars"
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} /><small>each</small></label>
        {error && <p className="l-error">{error}</p>}
        <div className="l-cal-actions">
          {current != null && <button className="l-btn l-ghost" type="button" disabled={busy} onClick={() => void save(null)}>No budget</button>}
          <button className="l-btn" type="submit" disabled={busy || !valid}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  )
}

/** Where the trip is: one line, like "Austin, Texas". */
function PlaceSheet({ pact, onClose, onSaved }: { pact: S.Pact; onClose: () => void; onSaved: () => void }) {
  const [place, setPlace] = useState(pact.location ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save(location: string) {
    setBusy(true); setError(null)
    try { await S.saveDetails(pact.pact_id, { ...S.detailsOf(pact), location: location.trim() }); onSaved() } catch (e) { setError((e as Error).message); setBusy(false) }
  }
  return (
    <Modal title="Where is it?" onClose={onClose}>
      <form className="l-compact l-small-form" onSubmit={(e) => { e.preventDefault(); void save(place) }}>
        <label className="l-money-field"><Icon name="pin" size={18} />
          <input autoFocus placeholder="Austin, Texas" value={place} maxLength={120} disabled={busy} aria-label="Where the trip is" onChange={(e) => setPlace(e.target.value)} /></label>
        {error && <p className="l-error">{error}</p>}
        <div className="l-cal-actions">
          {pact.location && <button className="l-btn l-ghost" type="button" disabled={busy} onClick={() => void save('')}>Clear</button>}
          <button className="l-btn" type="submit" disabled={busy || !place.trim() || place.trim() === (pact.location ?? '')}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  )
}
