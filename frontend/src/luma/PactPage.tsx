import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import * as S from './store'
import { DetailsForm, useApp } from './App'
import { Avatar, Busy, Cover, Grok, Icon, Modal, Switch, VerifiedBadge } from './ui'
import { PilotAnswerView } from './PilotCard'

type Sheet =
  | { kind: 'settings' } | { kind: 'addPeople' } | { kind: 'addItem' } | { kind: 'grok' }
  | { kind: 'summary'; rec: S.Recommendation } | { kind: 'booking'; booking: S.Booking }
  | { kind: 'action'; action: S.MoneyAction } | { kind: 'person'; member: S.Member }
  | { kind: 'send'; to: string | null; cents?: number; payback?: boolean; extras?: string } | { kind: 'info' } | { kind: 'dates' } | { kind: 'budget' } | { kind: 'place' }
  | { kind: 'removeItem'; item: S.Item }

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
  const [moves, setMoves] = useState<S.PactMove[] | null>(null)
  /** The itinerary's Edit mode: remove items, change how they're priced, issue a refund. */
  const [editing, setEditing] = useState(false)
  /** The share PactSplit actually holds for this pact, so activity shows real amounts. */
  const chainShareRef = useRef<number | null>(null)
  chainShareRef.current = d?.chain && d.chain.state !== 'none' ? Number(d.chain.share.usdc) || null : null
  const chainShare = chainShareRef.current
  // One place loads the activity (with the real share), so an earlier load can never overwrite a later one.
  useEffect(() => {
    let live = true
    void S.loadPactActivity(id, chainShare).then((m) => { if (live) setMoves(m) }).catch(() => undefined)
    return () => { live = false }
  }, [id, chainShare, tabVersion])
  /** The right panel: the group's Pact Chat, or a private Pact Pilot conversation. */
  const [panel, setPanel] = useState<'chat' | 'pilot'>(() => (S.takePilotFirst(id) ? 'pilot' : 'chat'))
  /** Set once you tap a tab yourself, so the page never switches it under you. */
  const pickedPanel = useRef(false)
  const pick = (next: 'chat' | 'pilot') => { pickedPanel.current = true; setPanel(next) }
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
  // Votes and balances reload when something changes (live, below) and right after I act. A once-a-minute check
  // while the page is on screen is only a backup in case a live update is missed.
  useEffect(() => { reloadSide(); return S.pollWhileVisible(reloadSide, 60000) }, [reloadSide, tabVersion])
  const chatRef = useRef<HTMLElement>(null)
  const slotRef = useRef<HTMLDivElement>(null)
  const dockedHeight = useRef(0)
  const animating = useRef(false)
  const HEAVY = { duration: 620, easing: 'cubic-bezier(0.7, 0, 0.2, 1)' }
  // On desktop the app is zoomed to 80%; measured boxes come back zoomed, so turn them back into the page's own pixels.
  const zoom = () => Number(getComputedStyle(document.documentElement).zoom) || 1
  const box = (r: DOMRect) => { const z = zoom(); return { top: `${r.top / z}px`, left: `${r.left / z}px`, width: `${r.width / z}px`, height: `${r.height / z}px`, bottom: 'auto', transform: 'none' } }
  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  function toggleFull() {
    const el = chatRef.current
    if (!el || animating.current) return
    if (reduced()) { setFullChat((f) => !f); return }
    animating.current = true
    const from = el.getBoundingClientRect()
    if (!fullChat) {
      dockedHeight.current = from.height / zoom()
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

  // Everything on this page is live: chat messages arrive as they're sent, and any change to the plan, votes, money
  // or tab reloads the page once (changes that land together are batched). Nothing re-asks the database on a timer,
  // apart from a once-a-minute backup check while the page is on screen.
  useEffect(() => {
    void S.loadMessages(id).then((all) => { setMessages(all); if (!all.length && !pickedPanel.current) setPanel('pilot') })
    let pending: ReturnType<typeof setTimeout> | null = null
    const changed = () => {
      if (pending) clearTimeout(pending)
      pending = setTimeout(() => { pending = null; void refreshPact(id); setTabVersion((v) => v + 1) }, 600)
    }
    // Chat has its own connection, so it stays live even if the other live updates aren't switched on yet.
    const chat = S.supabase.channel(`pact-messages:${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pact_messages', filter: `pact_id=eq.${id}` }, (payload) => {
        const m = payload.new as S.Message
        setMessages((all) => (all.some((x) => x.message_id === m.message_id) ? all : [...all, m]))
      }).subscribe()
    let channel = S.supabase.channel(`pact-live:${id}`)
    for (const table of S.LIVE_PACT_TABLES) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `pact_id=eq.${id}` }, changed)
    }
    // Votes have no pact id on them; the database only sends votes from pacts I'm in, so reload on any.
    for (const table of ['pact_poll_votes', 'pact_decision_votes']) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, changed)
    }
    channel.subscribe()
    const stop = S.pollWhileVisible(() => void refreshPact(id), 60000)
    void refreshPact(id)
    return () => { stop(); if (pending) clearTimeout(pending); void S.supabase.removeChannel(channel); void S.supabase.removeChannel(chat) }
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

  const details0 = pact ? S.detailsOf(pact) : null
  const findAsk = pact ? S.findQuestion(details0?.kind ?? 'other', pact.location, S.dateRange(pact.starts_on, pact.ends_on) ?? null, details0?.budget ?? null) : ''
  const findText = S.findLabel(null, details0?.kind)
  function findOptions() { if (!findAsk) return; setQueued({ q: findAsk, n: Date.now() }); setPanel('pilot') }

  function doStep() {
    if (!step || !d) return
    switch (step.kind) {
      // Planning: Pact Pilot searches for real options and puts them to a vote. Ticks are approvals, so nobody types.
      case 'talk': case 'declined': return findOptions()
      case 'approve': return void run(wallet ? 'Approving…' : 'Set your PIN…', async () => { await S.approve(step.decision, wallet); if (!wallet) app.setWallet(await S.loadWallet()) })
      case 'needsWallet': return void run('Set your PIN…', async () => app.setWallet(await S.makeWallet()))
      case 'startCollecting': return setSheet({ kind: 'action', action: 'create_pact' })
      case 'pay': return setSheet({ kind: 'action', action: 'pay_share' })
      case 'finalise': return setSheet({ kind: 'action', action: 'release' })
      case 'reallocate': return setSheet({ kind: 'action', action: 'cancel' })
      case 'reopen': return setSheet({ kind: 'action', action: 'create_pact' })
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
            {moves && moves.length > 0 && d && <PactActivity moves={moves} me={me} members={d.members} hostId={S.coordinator(d)?.user_id ?? null} />}
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
              <TitleChip icon="pin" label={pact.location || 'Add place'} empty={!pact.location} glow={!pact.location}
                canEdit={iCoordinate} hint="Where" onClick={() => setSheet({ kind: 'place' })} />
              <div className="l-meta-right">
                <TitleChip icon="calendar" label={S.dateRange(pact.starts_on, pact.ends_on) ?? 'Add dates'} empty={!pact.starts_on} glow={Boolean(pact.location) && !pact.starts_on}
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
          {d?.chain?.myRefund && (
            <div className="l-card l-status">
              <h3>You have {S.dollars(Number(d.chain.myRefund.amount))} to take back</h3>
              <p>The collection was cancelled, so the share you paid is yours again. It goes straight back to your wallet.</p>
              <button className="l-btn l-glow" type="button" onClick={() => setSheet({ kind: 'action', action: 'claim_refund' })}>Take back {S.dollars(Number(d.chain.myRefund.amount))}</button>
            </div>
          )}
          {error && <p className="l-error">{error}</p>}

          {!finished && <><div className="l-actions-row">
            <div className="l-actions">
            <button className="l-pill" type="button" onClick={() => setSheet({ kind: 'addItem' })}><Icon name="plus" />Add item</button>
            <button className="l-pill" type="button" disabled={Boolean(grokJob && !grokJob.error)} onClick={() => { setQueued({ q: S.summaryQuestion, n: Date.now() }); setPanel('pilot') }}><Icon name="text" />Summary</button>
            </div>
            {/* Sends what's on the plan as one plan for everyone to approve, priced at the items' total each. Only shows
                once there's something on the plan, so it never guesses from the chat. */}
            {(step?.kind === 'talk' || step?.kind === 'declined') && d && d.items.length > 0 && S.itemsTotal(d.items, d.members.length) != null && (
              <button className={['l-book', 'l-glow'].join(' ')} type="button" disabled={Boolean(grokJob && !grokJob.error)}
                title="Everyone on the pact approves this plan before anyone pays"
                onClick={() => void runGrok('Sending the plan to the group to approve…', () => S.sendForApproval(id, pact!, me, polls, name))}>
                <Icon name="sparkles" />Send {d.items.length} {d.items.length === 1 ? 'item' : 'items'} for approval · {S.dollars(S.itemsTotal(d.items, d.members.length)!)} each
              </button>
            )}
          </div>

          </>}

          {/* Itinerary: everything you're booking, by date, with where it's up to. Picks from votes land here. */}
          {d && (
            <div className="l-about" ref={findingsRef}>
              <div className="l-itinerary-head">
                <div className="l-section-title">Itinerary</div>
                {d.items.length > 0 && step && <span className={`l-itinerary-status ${itineraryStatus(step).tone}`}>{itineraryStatus(step).text}</span>}
                {iCoordinate && d.items.length > 0 && d.chain?.state !== 'released' && (
                  <button className="l-pill" type="button" style={{ marginLeft: 'auto' }} onClick={() => setEditing((e) => !e)}>{editing ? 'Done' : 'Edit'}</button>
                )}
              </div>
              {/* Edit: while the money is still held in the pact, the coordinator can refund everyone. */}
              {editing && (
                <div className="l-itinerary-edit">
                  <span className="l-faint">Remove an item or change how it's priced. Shares update for everyone.</span>
                  {d.chain?.state === 'open' && (
                    <button className="l-btn l-ghost" type="button" style={{ color: '#ff8a6b' }}
                      onClick={() => setSheet({ kind: 'action', action: 'cancel' })}>
                      <Icon name="shield" size={14} />Issue a refund{d.chain.sharesPaid ? ` · ${d.chain.sharesPaid} paid` : ''} · PIN
                    </button>
                  )}
                </div>
              )}
              {!d.items.length && <p className="l-faint" style={{ margin: '4px 0 0', fontSize: 14 }}>Nothing picked yet. Vote on Pact Pilot's options in Pact Chat, and the winners land here.</p>}
              {d.items.length > 0 && <Items items={d.items} d={d} grouped canRemove={editing && iCoordinate && Boolean(d.plan) && d.chain?.state !== 'released'}
                canEdit={editing && iCoordinate && d.chain?.state !== 'released'}
                onScope={(item, scope) => void run(scope === 'group' ? 'Splitting it between everyone…' : 'Making it per person…', async () => { await S.setItemScope(id, item.item_id, scope); await refreshPact(id) })}
                onRemove={(item) => setSheet({ kind: 'removeItem', item })} />}
            </div>
          )}

          {/* Past votes: what the group already decided. Open votes are in Pact Chat. */}
          {d && pact && polls.some((p) => p.status !== 'open') && (
            <PastVotes polls={polls.filter((p) => p.status !== 'open').sort((x, y) => y.created_at.localeCompare(x.created_at))}
              me={me} members={d.members} pact={pact} iCoordinate={iCoordinate} locked={Boolean(d.plan)} onChanged={reloadSide} />
          )}

          {d && tab?.pending && tab.pending.length > 0 && (
            <PendingSplits pending={tab.pending} me={me} members={d.members} working={working}
              onApprove={(expenseId) => void run('Approving…', async () => { await S.approveSplit(expenseId); reloadSide() })} />
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
            <button type="button" role="tab" aria-selected={panel === 'chat'} className={panel === 'chat' ? 'on' : ''} onClick={() => pick('chat')}>Pact Chat</button>
            {/* While planning, the Pact Pilot tab glows from Pact Chat to say: start here. */}
            <button type="button" role="tab" aria-selected={panel === 'pilot'}
              className={[panel === 'pilot' ? 'on' : '', panel === 'chat' && (step?.kind === 'talk' || step?.kind === 'declined') ? 'l-glow' : ''].join(' ')}
              onClick={() => pick('pilot')}><Grok size={14} />Pact Pilot</button>
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
            onAct={doStep} findAsk={findAsk} findText={findText} hasPolls={polls.length > 0} canEdit={iCoordinate}
            onSetPlace={() => setSheet({ kind: 'place' })} onSetDates={() => setSheet({ kind: 'dates' })}
            onChanged={() => { reloadSide(); setTabVersion((v) => v + 1); void refreshPact(id) }} />
        ) : <>
        {d && d.recommendations.length > 0 && (
          <GrokBlock rec={d.recommendations[d.recommendations.length - 1]} big onOpen={(rec) => setSheet({ kind: 'summary', rec })} />
        )}
        <Chat messages={messages} me={me} name={name} members={d?.members ?? []} polls={polls} pact={pact} iCoordinate={iCoordinate} locked={Boolean(d?.plan)} canSend={step?.kind === 'talk' || step?.kind === 'declined'}
          onRetry={(q) => { setQueued({ q, n: Date.now() }); setPanel('pilot') }}
          onVoted={reloadSide} onAddedToPlan={() => { reloadSide(); void refreshPact(id) }}
          onSeeFindings={() => findingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          recs={(d?.recommendations ?? []).slice(0, -1)} onGrok={(rec) => setSheet({ kind: 'summary', rec })} />
        {d?.chain?.myRefund && (
          <div className="l-card l-status">
            <h3>You have {S.dollars(Number(d.chain.myRefund.amount))} to take back</h3>
            <p>The collection was cancelled, so the share you paid is yours again. It goes straight back to your wallet.</p>
            <button className="l-btn l-glow" type="button" onClick={() => setSheet({ kind: 'action', action: 'claim_refund' })}>Take back {S.dollars(Number(d.chain.myRefund.amount))}</button>
          </div>
        )}
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
      {sheet?.kind === 'removeItem' && d && <RemoveItemSheet id={id} item={sheet.item} d={d} me={me}
        onClose={() => setSheet(null)} onDone={(act) => { setSheet(act ? { kind: 'action', action: 'cancel' } : null); reloadSide(); void refreshPact(id) }} />}
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
    talk: 'Find options and vote', declined: 'Not yet', approve: 'Approve the plan', waitingApprovals: 'Waiting on the group',
    needsWallet: 'Everyone approved', settingUp: 'Everyone approved', waitSetup: 'Everyone approved', startCollecting: 'Start collecting',
    waitStart: 'Split is ready', checking: 'Checking the split', pay: 'Approve your share', waitPay: 'Collecting', finalise: 'Everyone has paid', waitFinalise: 'Everyone has paid',
    done: 'Booked', cancelled: 'Cancelled', reallocate: 'Someone left', waitReopen: 'Someone left', reopen: 'Collecting was cancelled',
  }
  const body: Partial<Record<S.Step['kind'], string>> = {
    talk: 'Pact Pilot finds real options and puts them to a vote. Everyone just ticks the one they want, no typing, and the winner goes up for approval.',
    declined: 'Someone said not yet. Find new options and vote again.',
    approve: 'Pact Pilot wrote up what the group agreed. Everyone approves before anyone pays.',
    needsWallet: 'Set your PIN to make the wallet everyone pays into.',
    startCollecting: 'Everyone approved. Open the collection so everyone pays their share, then book it once it’s all in.',
    pay: 'Pay your share into the pact. It goes to the coordinator once everyone has paid.',
    finalise: 'Release the money to yourself and book it.',
    reallocate: 'The shares need to change. Cancel this collection so everyone who paid gets it back, then reopen it so the people still in share the same total.',
    waitReopen: "The coordinator is reopening the collection so the people still in share the cost. Don't pay until it reopens.",
    reopen: 'Everyone who paid can take their share back. Reopen it to collect again from the people still in.',
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
          <button className={['l-btn', step.kind === 'talk' || step.kind === 'declined' ? '' : 'l-glow'].join(' ')} type="button" onClick={onAct}>{label.text}</button>
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
    case 'startCollecting': case 'waitStart': case 'checking': case 'pay': case 'waitPay': case 'finalise': case 'waitFinalise':
    case 'reallocate': case 'waitReopen': case 'reopen': return 2
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

function Items({ items, d, canRemove, onRemove, canEdit, onScope, grouped }: {
  items: S.Item[]; d?: S.PactData; canRemove?: boolean; onRemove?: (item: S.Item) => void
  canEdit?: boolean; onScope?: (item: S.Item, scope: 'each' | 'group') => void; grouped?: boolean
}) {
  const dayOf = (i: S.Item) => (i.starts_on ? new Date(`${i.starts_on}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'Any time')
  const people = d?.members.length ?? 1
  const total = S.itemsTotal(items, people)
  return (
    <div style={{ marginTop: 6 }}>
      {items.map((i, n) => (
        <Fragment key={i.item_id}>
        {grouped && (n === 0 || dayOf(items[n - 1]) !== dayOf(i)) && <div className="l-itinerary-day">{dayOf(i)}</div>}
        <div className="l-item">
          <div className="l-item-icon"><Icon name={i.kind} /></div>
          <div style={{ minWidth: 0 }}><b>{i.title}</b><span>{[S.itemTitle(i.kind), S.dateRange(i.starts_on, i.ends_on), i.location].filter(Boolean).join(' · ')}</span></div>
          {i.price_each != null && <span className="l-item-price" title={S.priceText(i, people) ?? ''}>
            {i.price_scope === 'group' ? <>{S.dollars(S.itemEach(i, people)!)}<small className="l-faint" style={{ display: 'block', fontSize: 11, fontWeight: 600 }}>{S.dollars(i.price_each)} split</small></> : S.dollars(i.price_each)}
          </span>}
          {/* Bought once for everyone (a domain, a house) or paid by each person (tickets, meals)? Tap to flip. */}
          {canEdit && onScope && i.price_each != null && (
            <button className="l-pill" type="button" style={{ padding: '5px 10px', fontSize: 12 }}
              title={i.price_scope === 'group' ? 'Each person pays the full price' : 'Bought once for the whole group, so the price is split'}
              onClick={() => onScope(i, i.price_scope === 'group' ? 'each' : 'group')}>{i.price_scope === 'group' ? 'For the group' : 'Each'}</button>
          )}
          {i.link && <a className="l-icon-btn" href={i.link} target="_blank" rel="noreferrer" aria-label="Open link"><Icon name="link" /></a>}
          {canRemove && onRemove && <button className="l-icon-btn" type="button" aria-label={`Remove ${i.title}`} title="Remove from the plan" onClick={() => onRemove(i)}><Icon name="x" /></button>}
        </div>
        </Fragment>
      ))}
      {total != null && <div className="l-item"><b style={{ flex: 1 }}>Each person pays</b><span className="l-item-price">{S.dollars(total)}</span></div>}
    </div>
  )
}

function Chat({ messages, recs, onGrok, me, name, members, polls, pact, iCoordinate, locked, canSend, onVoted, onAddedToPlan, onSeeFindings, onRetry }: {
  messages: S.Message[]; recs: S.Recommendation[]; onGrok: (rec: S.Recommendation) => void; me: string; name: (id: string) => string; members: S.Member[]
  polls: S.Poll[]; pact: S.Pact | undefined; iCoordinate: boolean; locked: boolean; canSend: boolean; onVoted: () => void; onAddedToPlan: () => void; onSeeFindings: () => void
  onRetry: (question: string) => void
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
  if (!entries.length) return <p className="l-chat-empty">Say hi to the group. To get going, open Pact Pilot: it finds options and puts them to a vote, and everyone just ticks one.</p>
  return (
    <div className="l-chat">
      {entries.map((e, i) => {
        const prev = entries[i - 1]
        const day = new Date(e.at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        const newDay = !prev || new Date(prev.at).toDateString() !== new Date(e.at).toDateString()
        const divider = newDay && <div className="l-chat-day" key={`d${i}`}><span>{day}</span></div>
        if (e.kind === 'grok') return [divider, <GrokBlock key={e.rec.recommendation_id} rec={e.rec} onOpen={onGrok} />]
        // A vote shows right in the chat as cards everyone can tick, the same as in Findings.
        if (e.kind === 'poll') return [divider, pact
          ? <PollCard key={e.poll.poll_id} poll={e.poll} me={me} members={members} pact={pact} iCoordinate={iCoordinate} locked={locked} canSend={canSend} compact onVoted={onVoted} onAddedToPlan={onAddedToPlan} onRetry={onRetry} />
          : <FoundSummary key={e.poll.poll_id} found={e.poll} votes={Object.keys(e.poll.votes).length} onOpen={onSeeFindings} />]
        const m = e.m
        const found = S.parseOptions(m.body)
        if (found) return [divider, pact
          ? <MessageOptions key={m.message_id} id={pact.pact_id} found={found} onStarted={onVoted} />
          : <FoundSummary key={m.message_id} found={found} onOpen={onSeeFindings} />]
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

/** Talk to Pact Pilot: records you, stops by itself when you pause, and ElevenLabs writes down what you said.
 *  Works in any browser with a microphone, unlike the browser's own voice typing. */
function useVoiceRecorder(onHeard: (text: string) => void) {
  const supported = typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
  const [state, setState] = useState<'idle' | 'listening' | 'hearing'>('idle')
  const [failure, setFailure] = useState<string | null>(null)
  const stopNow = useRef<(() => void) | null>(null)
  const heard = useRef(onHeard)
  heard.current = onHeard
  useEffect(() => () => stopNow.current?.(), [])

  async function start() {
    if (state !== 'idle') return
    setFailure(null)
    let stream: MediaStream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }) }
    catch (e) { setFailure((e as DOMException).name === 'NotFoundError' ? speechMessages['audio-capture'] : speechMessages['not-allowed']); return }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t))
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }

    // Listen for a pause: once you've spoken, 1.4 seconds of quiet ends the recording. Nothing said in 8 seconds cancels it.
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    ctx.createMediaStreamSource(stream).connect(analyser)
    const samples = new Uint8Array(analyser.fftSize)
    const began = performance.now()
    let spoke = false
    let lastLoud = began
    let frame = 0
    const watch = () => {
      analyser.getByteTimeDomainData(samples)
      let sum = 0
      for (const s of samples) sum += ((s - 128) / 128) ** 2
      const now = performance.now()
      if (Math.sqrt(sum / samples.length) > 0.035) { spoke = true; lastLoud = now }
      if ((spoke && now - lastLoud > 1400) || (!spoke && now - began > 8000) || now - began > 45000) return void finish()
      frame = requestAnimationFrame(watch)
    }
    const finish = () => { if (recorder.state !== 'inactive') recorder.stop() }
    recorder.onstop = async () => {
      cancelAnimationFrame(frame)
      stream.getTracks().forEach((t) => t.stop())
      void ctx.close()
      stopNow.current = null
      if (!spoke || !chunks.length) { setState('idle'); setFailure("Didn't hear anything. Tap the mic and talk."); return }
      setState('hearing')
      try { heard.current((await S.transcribe(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))).trim()) }
      catch (e) { setFailure((e as Error).message) }
      setState('idle')
    }
    stopNow.current = finish
    recorder.start()
    setState('listening')
    frame = requestAnimationFrame(watch)
  }
  return { supported, state, failure, start, stop: () => stopNow.current?.(), clear: () => setFailure(null) }
}

/** Pact Pilot, one to one: preset prompts, your questions and its answers, and voice (speak, and hear it answer).
 *  Its changes still need your Approve, and its status updates still show in Pact Chat. */
const PILOT_PRESETS: { label: string; icon: string; ask?: string; fill?: string; summary?: boolean }[] = [
  { label: 'Vote on the idea', icon: 'sparkles', ask: "Put our idea to a vote so we agree before planning anything: give 3 clear options for what this pact is (what we do and where), each with a rough price per person, and put them to a vote." },
  { label: 'Vote on 3 events', icon: 'ticket', ask: 'Find the top 3 paid events or activities that fit our place, dates and budget, each with its ticket price per person, when it is, and a link, and put them to a vote.' },
  { label: 'Vote on 3 stays', icon: 'stay', ask: 'Find 3 real places to stay that fit our dates and budget each, and put them to a vote.' },
  { label: 'Sum up the chat', icon: 'wave', summary: true },
  { label: "What's left to decide?", icon: 'checkCircle', ask: 'What does this pact still need decided before we can book?' },
  { label: 'Who owes what?', icon: 'wallet', ask: 'Who owes what on the tab, and what are the fewest paybacks to square up?' },
  { label: 'Who are we waiting on?', icon: 'pacts', ask: 'Who is this pact waiting on right now, and for what?' },
  { label: 'Split a cost', icon: 'plus', fill: 'I paid $ for  , split with everyone' },
]

/** While Pact Pilot works: the steps it's going through, one after another, with a moving bar. Research (a vote,
 *  finding places or events) gets research steps; anything else gets a short read-and-answer sequence. */
const RESEARCH = /\b(poll|vote|find|search|look for|top \d|options|stays?|hotels?|events?|activities|flights?|restaurants?)\b/i
function PilotThinking({ question }: { question: string }) {
  const steps = RESEARCH.test(question)
    ? ['Reading the chat', 'Searching for real options', 'Checking prices and dates', 'Comparing the best ones', 'Building the vote']
    : ['Reading the chat', 'Checking the plan and the tab', 'Writing the answer']
  const [at, setAt] = useState(0)
  useEffect(() => { const t = setInterval(() => setAt((n) => Math.min(n + 1, steps.length - 1)), 2200); return () => clearInterval(t) }, [steps.length])
  return (
    <div className="l-research" role="status" aria-live="polite">
      <div className="l-research-bar"><i /></div>
      <ul>
        {steps.map((s, i) => (
          <li key={s} className={i < at ? 'done' : i === at ? 'now' : ''}>
            <span className="l-research-dot" />{s}{i === at && <span className="l-dots"><i /><i /><i /></span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function PilotPanel({ id, me, pact, d, queued, onChanged, onOpenChat, onAct, findAsk, findText, hasPolls, canEdit, onSetPlace, onSetDates }: {
  id: string; me: string; pact: S.Pact | null; d: S.PactData; queued?: { q: string; n: number } | null; onChanged: () => void; onOpenChat: () => void
  onAct: () => void; findAsk: string; findText: string; hasPolls: boolean; canEdit: boolean; onSetPlace: () => void; onSetDates: () => void
}) {
  const members = d.members
  const [text, setText] = useState('')
  const [log, setLog] = useState<{ key: number; question: string; summary: boolean; answer: S.PilotAnswer | null; error: string | null; old?: boolean }[]>([])
  const [voiceOn, setVoiceOn] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const voice = useDictation(setText)
  // Speak to Pact Pilot: what you say is asked straight away, and the answer is read back to you.
  const talk = useVoiceRecorder((said) => { if (said) { setVoiceOn(true); void ask(said) } else setVoiceError("Didn't catch that. Try again.") })
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
      if (answer.poll) onChanged() // the new vote shows in Pact Chat and Findings straight away
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
            {/* Start here: the next thing to do glows. Place and dates first, so the search finds the right things. */}
            {!hasPolls && (
              <div className="l-start">
                <span className="l-pilot-presets-label">Start here</span>
                {canEdit && !pact?.location && <button type="button" className="l-start-step l-glow" onClick={onSetPlace}><Icon name="pin" size={16} /><span><b>Add the place</b><small>So Pact Pilot searches in the right city</small></span></button>}
                {canEdit && pact?.location && !pact.starts_on && <button type="button" className="l-start-step l-glow" onClick={onSetDates}><Icon name="calendar" size={16} /><span><b>Set the dates</b><small>So it only finds what's on when you go</small></span></button>}
                <button type="button" className={['l-start-step', (!canEdit || (pact?.location && pact.starts_on)) ? 'l-glow' : ''].join(' ')} disabled={!findAsk} onClick={() => void ask(findAsk)}>
                  <Icon name="sparkles" size={16} /><span><b>{findText}</b><small>Pact Pilot searches and puts 3 to a vote. Everyone just ticks one.</small></span>
                </button>
              </div>
            )}
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
              {x.answer ? <PilotAnswerView id={id} me={me} members={members} answer={x.answer} onDone={onChanged} onOpenChat={onOpenChat} onDismiss={() => setLog((l) => l.filter((y) => y.key !== x.key))} />
                : x.error ? <p className="l-error">{x.error}</p>
                : <PilotThinking question={x.question} />}
            </div>
            {x.answer && x.key === log[log.length - 1].key && <NextUp id={id} me={me} pact={pact} d={d} onAsk={(q) => void ask(q)} onAct={onAct} findAsk={findAsk} findText={findText} />}
          </div>
        ))}
        <div ref={end} />
      </div>
      {/* Every shortcut shows (they wrap), so nothing hides off the edge. Votes first, then questions. */}
      <div className="l-pilot-presets" aria-label="Things to ask Pact Pilot">
        <span className="l-pilot-presets-label">Try</span>
        {PILOT_PRESETS.map((p) => <button key={p.label} type="button" className="l-pill" onClick={() => pick(p)}><Icon name={p.icon} size={14} />{p.label}</button>)}
      </div>
      {(talk.failure || voice.failure || voiceError) && <p className="l-error">{talk.failure ?? voice.failure ?? voiceError}</p>}
      <form className="l-composer grok" onSubmit={(e) => { e.preventDefault(); void ask(text) }}>
        <textarea ref={box} rows={1} value={text} placeholder={talk.state === 'listening' ? "Listening… pause when you're done" : talk.state === 'hearing' ? 'Writing down what you said…' : voice.listening ? 'Listening… speak now' : 'Ask Pact Pilot anything'} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(text) } }} />
        {talk.supported ? (
        <button type="button" className={talk.state !== 'idle' ? 'l-icon-btn l-mic on' : 'l-icon-btn l-mic'} disabled={talk.state === 'hearing'}
          onClick={() => { if (talk.state === 'listening') talk.stop(); else { audio.current?.pause(); setVoiceError(null); setVoiceOn(true); void talk.start() } }}
          aria-label={talk.state === 'listening' ? 'Done talking' : 'Talk to Pact Pilot'} title={talk.state === 'listening' ? 'Done talking' : 'Talk to Pact Pilot. It answers out loud.'}>
          <Icon name={talk.state === 'idle' ? 'mic' : 'wave'} />
        </button>
        ) : (
        <button type="button" className={voice.listening ? 'l-icon-btn l-mic on' : 'l-icon-btn l-mic'}
          onClick={() => { if (voice.listening) { voice.stop(); void ask(text) } else { setVoiceOn(true); void voice.start(text) } }}
          aria-label={voice.listening ? 'Stop and ask' : 'Talk to Pact Pilot'} title={voice.listening ? 'Stop and ask' : 'Talk to Pact Pilot'}>
          <Icon name={voice.listening ? 'wave' : 'mic'} />
        </button>
        )}
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
function NextUp({ id, me, pact, d, onAsk, onAct, findAsk, findText }: {
  id: string; me: string; pact: S.Pact | null; d: S.PactData; onAsk: (q: string) => void; onAct: () => void; findAsk: string; findText: string
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
      if (u === me) {
        const label = { approve: 'Approve', start: 'Start collecting', pay: w.amount != null ? `Pay ${S.dollars(w.amount)}` : 'Pay', release: 'Release' }[w.what]
        items.push({ key: u, text: `You need to ${doing}`, button: { label, run: onAct } })
      }
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
  if (!d.recommendations.length && !d.plan && findAsk) items.push({ key: 'find', text: 'Nothing picked yet', button: { label: findText, run: () => onAsk(findAsk) } })
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
  const { me, refresh, refreshPact, go } = useApp()
  const iCoordinate = S.coordinator(d)?.user_id === me
  const locked = Boolean(d.plan)
  const [confirming, setConfirming] = useState(false)
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
        {S.itemsTotal(d.items, d.members.length) != null && <span className="l-dim" style={{ fontSize: 14, fontWeight: 600 }}>{S.dollars(S.itemsTotal(d.items, d.members.length)!)} each</span>}
      </div>
      {d.items.length ? d.items.map((i) => (
        <div className="l-item" key={i.item_id}>
          <div className="l-item-icon"><Icon name={i.kind} /></div>
          <div style={{ minWidth: 0, flex: 1 }}><b>{i.title}</b><span>{[S.itemTitle(i.kind), S.dateRange(i.starts_on, i.ends_on), i.location].filter(Boolean).join(' · ')}</span></div>
          {i.price_each != null && <span className="l-item-price">{S.dollars(S.itemEach(i, d.members.length)!)}</span>}
          {i.link && <a className="l-icon-btn" href={i.link} target="_blank" rel="noreferrer" aria-label="Open link"><Icon name="link" /></a>}
          {!locked && (i.created_by === me || iCoordinate) && <button className="l-remove" type="button" disabled={busy} onClick={() => void act(() => S.removeItem(i.item_id))}>Remove</button>}
        </div>
      )) : <p className="l-faint" style={{ fontSize: 14 }}>Nothing added yet. Add the stays, flights, tickets and dinners you're booking.</p>}
      {!locked && <button className="l-btn l-ghost l-wide-btn" style={{ marginTop: 12 }} type="button" onClick={onAddItem}><Icon name="plus" size={16} />Add to itinerary</button>}
      {/* Leave (anyone) or delete (the coordinator). A second tap confirms, so nothing goes on a slip. */}
      <div className="l-head" style={{ margin: '22px 0 6px' }}><b className="l-dim">{iCoordinate ? 'Delete this pact' : 'Leave this pact'}</b></div>
      <p className="l-faint" style={{ fontSize: 13, margin: '0 0 10px' }}>
        {iCoordinate ? 'Deletes the chat, plan, votes and tab for everyone. This can’t be undone.'
          : locked ? 'You leave the chat and the plan. Your part of the split is shared by everyone else: the coordinator reopens the collection with new shares, and anything you paid comes back to you.'
          : 'You leave the chat and the plan. Someone can ask you back in later.'}
      </p>
      {confirming ? (
        <div className="l-pilot-buttons">
          <button className="l-btn l-danger" type="button" disabled={busy} style={{ background: '#d93b3b', color: '#fff' }}
            onClick={() => void (async () => {
              setBusy(true); setError(null)
              try {
                await (iCoordinate ? S.deletePact(pact.pact_id) : S.leavePact(pact.pact_id))
                onClose(); go('/pacts'); void refresh()
              } catch (e) { setError((e as Error).message); setConfirming(false); setBusy(false) }
            })()}>
            {busy ? (iCoordinate ? 'Deleting…' : 'Leaving…') : iCoordinate ? `Yes, delete ${pact.name}` : `Yes, leave ${pact.name}`}
          </button>
          <button className="l-btn l-ghost" type="button" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      ) : (
        <button className="l-btn l-ghost l-wide-btn" type="button" style={{ color: '#ff6b6b' }} onClick={() => { setError(null); setConfirming(true) }}>
          {iCoordinate ? 'Delete pact' : 'Leave pact'}
        </button>
      )}
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
          <label className="l-field"><span>{draft.scope === 'group' ? 'Price for the group' : 'Price each'}</span><input className="l-input" inputMode="decimal" value={draft.price ?? ''} onChange={(e) => set({ price: e.target.value === '' ? null : Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })} placeholder="$" /></label>
          {/* A domain or a whole house is bought once and split; tickets and meals are per person. */}
          <div className="l-field"><span>Who pays this price</span>
            <div className="l-kinds">
              <button type="button" className={draft.scope !== 'group' ? 'on' : ''} onClick={() => set({ scope: 'each' })}>Each person</button>
              <button type="button" className={draft.scope === 'group' ? 'on' : ''} onClick={() => set({ scope: 'group' })}>Whole group, split</button>
            </div>
          </div>
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
function ActionSheet({ id, action: first, d, iCoordinate, onClose }: { id: string; action: S.MoneyAction; d: S.PactData; iCoordinate: boolean; onClose: () => void }) {
  const { me, refreshPact, setWallet } = useApp()
  const [action, setAction] = useState<S.MoneyAction>(first)
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const chain = d.chain
  const share = Number(chain?.share.usdc ?? d.plan?.share_usdc ?? 0)
  const total = Number(chain?.total.usdc ?? 0) || share * (d.plan?.shares_needed ?? d.members.length)
  const reopening = chain?.state === 'cancelled' || Boolean(chain?.needsReopen)
  const newShare = chain?.reopenShare ?? share
  const refund = Number(chain?.myRefund?.amount ?? 0)
  const copy = {
    create_pact: reopening
      ? { title: 'Reopen collecting', text: `Open a new collection so the people still in share the same total: ${S.dollars(newShare)} each. Anyone who paid before takes that back separately.`, button: `Reopen at ${S.dollars(newShare)} each` }
      : { title: 'Start collecting', text: `Open the split so everyone can pay their ${S.dollars(share)} share. It all comes to you once everyone has paid.`, button: 'Start collecting' },
    cancel: { title: 'Cancel collecting',
      text: chain?.needsReopen
        ? `Someone left, so the shares have to change. Cancelling lets everyone who paid take their ${S.dollars(share)} back. Then you reopen it at ${S.dollars(newShare)} each for the people still in.`
        : `Everyone who paid can take their ${S.dollars(share)} back. You can reopen it afterwards. You'll confirm with your PIN.`,
      button: 'Cancel and refund · confirm with PIN' },
    claim_refund: { title: 'Take your share back', text: `The collection was cancelled. Take back the ${S.dollars(refund)} you paid in. It goes straight to your wallet.`, button: `Take back ${S.dollars(refund)}` },
    pay_share: { title: 'Approve your share', text: `Pay ${S.dollars(share)} into the pact. It's held until everyone has paid, then goes to the coordinator.`, button: `Approve ${S.dollars(share)}` },
    release: { title: 'Finalise and book', text: `Everyone has paid. Release ${S.dollars(total)} to yourself, then book it.`, button: `Finalise · ${S.dollars(total)}` },
  }[action]
  // Collecting already started (on another device, or before this page refreshed): say so, nothing to do here.
  const alreadyOpen = action === 'create_pact' && chain != null && chain.state === 'open' && !chain.needsReopen
  const shown = alreadyOpen
    ? { title: 'Collecting has started', text: `The split is already open, so everyone can pay their ${S.dollars(share)} share now. There's nothing else to do here.`, button: '' }
    : copy
  const collectingFor = action === 'create_pact' && !reopening && !alreadyOpen ? d.items : []
  return (
    <Modal title={shown.title} onClose={onClose}>
      <p className="l-dim" style={{ marginTop: 0, lineHeight: 1.5 }}>{shown.text}</p>
      {collectingFor.length > 0 && <>
        <b className="l-dim">What everyone approved</b>
        {collectingFor.map((i) => (
          <div key={i.item_id} className="l-person"><span>{i.title}</span><small>{i.price_each != null ? `${S.dollars(Number(i.price_each))} each` : 'No price'}</small></div>
        ))}
        {iCoordinate && state === 'idle' && (
          <button className="l-btn l-ghost l-wide-btn" type="button" style={{ marginTop: 10 }}
            onClick={async () => { setError(null); try { await S.changePlan(id); await refreshPact(id); onClose() } catch (e) { setError((e as Error).message) } }}>
            Something's wrong? Change the plan
          </button>
        )}
      </>}
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
      {/* The coordinator can always call it off: everyone who paid takes their share back. */}
      {iCoordinate && chain?.state === 'open' && action !== 'cancel' && state === 'idle' && (
        <button className="l-btn l-ghost l-wide-btn" type="button" style={{ marginTop: 12, color: '#ff6b6b' }} onClick={() => { setError(null); setAction('cancel') }}>Cancel collecting and refund everyone</button>
      )}
      <div style={{ marginTop: 18 }}>
        {state === 'done' || alreadyOpen ? <button className="l-btn l-wide-btn" type="button" onClick={() => { void refreshPact(id); onClose() }}>Done</button>
          : state === 'busy' ? <Busy text="Confirm with your PIN, then Arc confirms it…" />
          : <button className="l-btn l-wide-btn" type="button" disabled={action !== 'pay_share' && action !== 'claim_refund' && !iCoordinate}
              onClick={async () => { setState('busy'); setError(null); try {
                await S.pactAction(action, id)
                if (action === 'cancel' && chain) {
                  const paid = chain.members.filter((m) => m.paid).map((m) => (m.userId === me ? 'you' : S.firstName(d.members.find((x) => x.user_id === m.userId)?.name)))
                  if (paid.length) void S.send(id, `Pact Pilot: The collection was cancelled and everyone's money is still safe in the pact. ${paid.join(', ')}: open the pact and tap Take back ${S.dollars(share)} to get your share back.`).catch(() => undefined)
                }
                await refreshPact(id); setWallet(await S.loadWallet()); setState('done') } catch (e) { const msg = (e as Error).message ?? ''; if (/already (on chain|started|open)/i.test(msg)) { await refreshPact(id); setState('done'); return } setError(msg || "That didn't go through. Try again."); setState('idle') } }}>{copy.button}</button>}
      </div>
    </Modal>
  )
}

/** Send USDC to someone in the pact by who they are, not their address. Confirmed with my PIN, and a note goes in the
 *  chat. From Settle it's a payback (it counts on the tab); from Send money it's a plain send. */
/** The pact's own money, newest first: who paid in, sends between members, the release, refunds. Each opens on Arc. */
function PactActivity({ moves, me, members, hostId }: { moves: S.PactMove[]; me: string; members: S.Member[]; hostId: string | null }) {
  const [all, setAll] = useState(false)
  const who = (u: string | null) => (!u ? 'Someone' : u === me ? 'You' : S.firstName(members.find((m) => m.user_id === u)?.name))
  const amt = (n: number | null) => (n == null ? '' : S.dollars(n))
  const line = (m: S.PactMove) => {
    switch (m.kind) {
      case 'paid': return { icon: 'down', text: `${who(m.from)} paid ${amt(m.amount)} in`, tone: 'in' }
      case 'sent': return { icon: 'up', text: `${who(m.from)} sent ${who(m.to)} ${amt(m.amount)}`, tone: 'out' }
      case 'released': return { icon: 'checkCircle', text: `${amt(m.amount) || 'The total'} released to ${who(hostId)}`, tone: 'in' }
      case 'cancelled': return { icon: 'x', text: 'Collection cancelled', tone: 'mute' }
      case 'refunded': return { icon: 'up', text: `${who(m.to)} took back ${amt(m.amount)}`, tone: 'out' }
    }
  }
  const shown = all ? moves : moves.slice(0, 5)
  return (
    <div className="l-pact-activity">
      <span className="l-pilot-presets-label">Pact activity</span>
      {shown.map((m) => {
        const l = line(m)
        const when = new Date(m.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        const body = <><span className={`l-pact-activity-icon ${l.tone}`}><Icon name={l.icon} size={13} /></span><span className="l-pact-activity-text">{l.text}</span><small>{when}</small></>
        return m.tx
          ? <a key={m.key} className="l-pact-activity-row" href={S.txLink(m.tx)} target="_blank" rel="noreferrer" title="See it on the Arc explorer">{body}</a>
          : <div key={m.key} className="l-pact-activity-row">{body}</div>
      })}
      {moves.length > 5 && <button type="button" className="l-link-btn" onClick={() => setAll((a) => !a)}>{all ? 'Show less' : `Show all ${moves.length}`}</button>}
    </div>
  )
}

/** Where the itinerary is up to, in one chip. */
function itineraryStatus(step: S.Step): { text: string; tone: 'go' | 'warn' | 'mute' } {
  switch (step.kind) {
    case 'done': return { text: 'Booked ✓', tone: 'go' }
    case 'cancelled': case 'reopen': return { text: 'Cancelled · refunds open', tone: 'mute' }
    case 'approve': case 'waitingApprovals': return { text: 'Up for approval', tone: 'warn' }
    case 'needsWallet': case 'settingUp': case 'waitSetup': case 'startCollecting': case 'waitStart': case 'checking': return { text: 'Approved · ready to collect', tone: 'warn' }
    case 'pay': case 'waitPay': return { text: 'Collecting', tone: 'warn' }
    case 'reallocate': case 'waitReopen': return { text: 'Changing the split', tone: 'warn' }
    case 'finalise': case 'waitFinalise': return { text: 'Paid · ready to book', tone: 'go' }
    default: return { text: 'Picked · not booked yet', tone: 'mute' }
  }
}

/** Votes the group already decided, newest first: one line each with the winner; tap to see every option. */
function PastVotes({ polls, me, members, pact, iCoordinate, locked, onChanged }: {
  polls: S.Poll[]; me: string; members: S.Member[]; pact: S.Pact; iCoordinate: boolean; locked: boolean; onChanged: () => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="l-about">
      <div className="l-section-title">Past votes</div>
      {polls.map((p) => {
        const count = (key: string) => Object.values(p.votes).filter((v) => v === key).length
        const winner = p.options.find((o) => o.key === p.winner_key) ?? [...p.options].sort((a, b) => count(b.key) - count(a.key))[0]
        const total = Object.keys(p.votes).length
        return (
          <Fragment key={p.poll_id}>
            <button type="button" className="l-item l-past-vote" onClick={() => setOpen(open === p.poll_id ? null : p.poll_id)} aria-expanded={open === p.poll_id}>
              <div className="l-item-icon"><Icon name="checkCircle" /></div>
              <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                <b>{p.title}</b>
                <span>{winner && count(winner.key) > 0 ? `Picked ${winner.name}` : 'No pick'} · {total} {total === 1 ? 'vote' : 'votes'} · {new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              </div>
              <Icon name={open === p.poll_id ? 'up' : 'down'} size={16} />
            </button>
            {open === p.poll_id && (
              <PollCard poll={p} me={me} members={members} pact={pact} iCoordinate={iCoordinate} locked={locked} canSend={false} compact
                onVoted={onChanged} onAddedToPlan={onChanged} onRetry={() => undefined} />
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

/** Take an item off a plan that's already split. Says exactly what happens to the money before you confirm. */
function RemoveItemSheet({ id, item, d, me, onClose, onDone }: {
  id: string; item: S.Item; d: S.PactData; me: string; onClose: () => void; onDone: (cancelNow: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chain = d.chain
  const share = Number(chain?.state === 'open' ? chain.share.usdc : d.plan?.share_usdc ?? 0)
  const price = S.itemEach(item, d.members.length) ?? 0
  const next = Math.round((share - price) * 100) / 100
  const open = chain?.state === 'open'
  const payers = open ? chain.members.filter((m) => m.paid) : []
  const name = (u: string) => (u === me ? 'You' : S.firstName(d.members.find((m) => m.user_id === u)?.name))
  return (
    <Modal title={`Remove ${item.title}?`} onClose={onClose}>
      <p className="l-dim" style={{ marginTop: 0, lineHeight: 1.5 }}>
        Everyone's share drops from {S.dollars(share)} to <b>{S.dollars(next)}</b>.{' '}
        {!open ? "Collecting hasn't started, so nobody has paid. It just changes the amount."
          : !payers.length ? "Collecting has started but nobody has paid yet. You'll cancel the collection and reopen it at the new amount."
          : `${payers.map((p) => name(p.userId)).join(', ')} already paid ${S.dollars(share)}. You'll cancel the collection, they each take their ${S.dollars(share)} back, and everyone pays ${S.dollars(next)} when you reopen it.`}
      </p>
      {error && <p className="l-error">{error}</p>}
      <div className="l-pilot-buttons">
        <button className="l-btn" type="button" disabled={busy || !(next > 0)}
          onClick={async () => {
            setBusy(true); setError(null)
            try { const r = await S.removePlanItem(id, item.item_id); onDone(Boolean(r?.reopen && open)) }
            catch (e) {
              // Someone else (or another tab) already removed it: refresh so it leaves the plan, and close.
              if (/already gone/i.test((e as Error).message)) return onDone(false)
              setError((e as Error).message); setBusy(false)
            }
          }}>{busy ? 'Removing…' : open ? 'Remove and cancel the collection' : `Remove · ${S.dollars(next)} each`}</button>
        <button className="l-btn l-ghost" type="button" disabled={busy} onClick={onClose}>Keep it</button>
      </div>
      {!(next > 0) && <p className="l-faint" style={{ fontSize: 13 }}>That's everything in the split. Use Change the plan to start again instead.</p>}
    </Modal>
  )
}

/** Splits from someone's wallet waiting for the group. Each person approves their part; once everyone has, it counts
 *  on the tab and shows in who owes what. */
function PendingSplits({ pending, me, members, working, onApprove }: {
  pending: S.PendingSplit[]; me: string; members: S.Member[]; working: string | null; onApprove: (expenseId: string) => void
}) {
  const who = (id: string) => (id === me ? 'You' : S.firstName(members.find((m) => m.user_id === id)?.name))
  return (
    <div className="l-about l-extras">
      <div className="l-section-title">Waiting for approval</div>
      {pending.map((e) => {
        const payer = Object.keys(e.payers)[0]
        const inIt = Object.keys(e.shares)
        const mine = e.shares[me]
        const approved = e.approved_by.includes(me)
        const left = inIt.filter((u) => !e.approved_by.includes(u))
        return (
          <div key={e.expense_id} className="l-item">
            <div className="l-item-icon"><Icon name="wallet" /></div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <b>{e.title}</b>
              <span>{who(payer)} paid {S.cents(e.total_cents)} · split {inIt.length} ways{mine ? ` · your part ${S.cents(mine)}` : ''}</span>
              <span className="l-faint">{left.length ? `Waiting on ${left.map(who).join(', ')}` : 'Everyone approved'}</span>
            </div>
            {mine != null && !approved
              ? <button className="l-settle" type="button" disabled={Boolean(working)} onClick={() => onApprove(e.expense_id)}>Approve {S.cents(mine)}</button>
              : <span className="l-faint" style={{ fontSize: 13 }}>{approved ? 'You approved' : ''}</span>}
          </div>
        )
      })}
    </div>
  )
}

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
              {o.price_each != null && <div className="l-opt-price">{S.dollars(o.price_each)}<small>{o.price_for === 'group' ? ' for the group' : ' each'}</small></div>}
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
function PollCard({ poll, me, members, pact, iCoordinate, locked, canSend, compact, onVoted, onAddedToPlan, onRetry }: {
  poll: S.Poll; me: string; members: S.Member[]; pact: S.Pact; iCoordinate: boolean; locked: boolean; canSend: boolean; compact?: boolean
  onVoted: () => void; onAddedToPlan: () => void; onRetry: (question: string) => void
}) {
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mineNow, setMineNow] = useState<string | null | undefined>(undefined) // my tap shows straight away
  const votes = { ...poll.votes }
  if (mineNow !== undefined) { if (mineNow) votes[me] = mineNow; else delete votes[me] }
  const total = Object.keys(votes).length
  const count = (key: string) => Object.values(votes).filter((v) => v === key).length
  const top = Math.max(0, ...poll.options.map((o) => count(o.key)))
  const open = poll.status === 'open'
  // A tick is your approval. Once more than half the group has ticked the same option, the vote decides itself: the
  // winner goes on the plan and up for approval, with everyone who ticked it already counted as approving.
  async function vote(key: string) {
    setBusy(key); setError(null); setMineNow(votes[me] === key ? null : key)
    try {
      await S.votePoll(poll.poll_id, key)
      const won = votes[me] === key ? null : await S.decidePoll(poll.poll_id)
      const option = won ? poll.options.find((o) => o.key === won) : null
      if (option) {
        const how = await S.approvePollPick(pact, poll, option, me, locked, canSend)
        setNote(how === 'extra' ? `The group picked ${option.name}. It went in as an extra for the group to approve.`
          : `The group picked ${option.name}. It's on the plan. Send the plan for approval when you're ready.`)
        onAddedToPlan()
      } else onVoted()
    } catch (e) { setError((e as Error).message); setMineNow(undefined) }
    setBusy(null)
  }
  // The coordinator or whoever started it can clear a vote away, open or decided. Try again is only for open ones.
  const canRemove = iCoordinate || poll.created_by === me
  const decidedOnce = useRef(false)
  useEffect(() => {
    if (!open || decidedOnce.current || top * 2 <= members.length) return
    decidedOnce.current = true
    void (async () => {
      const won = await S.decidePoll(poll.poll_id)
      const option = won ? poll.options.find((o) => o.key === won) : null
      if (!option) return
      try {
        const how = await S.approvePollPick(pact, poll, option, me, locked, canSend)
        setNote(how === 'extra' ? `The group picked ${option.name}. It went in as an extra.` : `The group picked ${option.name}. It's on the plan.`)
        onAddedToPlan()
      } catch (e) { setError((e as Error).message) }
    })()
  }, [open, top, members.length]) // eslint-disable-line react-hooks/exhaustive-deps
  async function remove(retry: boolean) {
    setBusy('remove'); setError(null)
    try {
      await S.removePoll(poll.poll_id)
      if (retry) onRetry(S.retryQuestion(poll))
      onVoted()
    } catch (e) { setError((e as Error).message); setBusy(null) }
  }
  // How many more ticks the leading option needs to decide the vote.
  const toDecide = Math.floor(members.length / 2) + 1 - top
  return (
    <div className="l-poll">
      <div className="l-poll-head">
        {poll.source === 'grok' && <span className="l-av" style={{ width: 28, height: 28, background: '#000' }}><Grok size={15} /></span>}
        <div><b>{poll.title}</b><span>{open ? `${total} of ${members.length} voted` : 'Decided'}</span></div>
        {/* Not a good set? Try again searches for 3 different ones; the X just removes it. */}
        {canRemove && (
          <div className="l-poll-tools">
            {open && <button className="l-pill" type="button" disabled={Boolean(busy)} title="Remove this and find 3 different options"
              onClick={() => void remove(true)}><Icon name="sparkles" size={14} />Try again</button>}
            <button className="l-x" type="button" disabled={Boolean(busy)} aria-label="Remove this vote" title={open ? 'Remove this vote' : 'Clear this vote away (its pick stays on the plan)'}
              onClick={() => void remove(false)}><Icon name="x" size={15} /></button>
          </div>
        )}
      </div>
      <OptionGrid options={poll.options} compact={compact} renderFoot={(o) => {
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
            {open && leading && toDecide > 0 && <span className="l-faint" style={{ fontSize: 12, marginLeft: 'auto' }}>{toDecide} more to decide</span>}
            {!open && poll.winner_key === o.key && <span className="l-faint" style={{ fontSize: 12, marginLeft: 'auto' }}>Picked</span>}
          </div>
        )
      }} />
      {note && <p className="l-dim" style={{ margin: '8px 0 0', fontSize: 13 }}>{note}</p>}
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
function TitleChip({ icon, label, empty, canEdit, hint, onClick, glow }: { icon: string; label: string; empty: boolean; canEdit: boolean; hint: string; onClick: () => void; glow?: boolean }) {
  if (!canEdit && empty) return null
  const body = <><Icon name={icon} size={16} /><span>{label}</span></>
  return canEdit
    ? <button className={[empty ? 'l-chip empty' : 'l-chip', glow ? 'l-glow' : ''].join(' ')} type="button" onClick={onClick} title={hint}>{body}</button>
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
