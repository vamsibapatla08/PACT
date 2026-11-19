import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import * as S from './store'
import { Avatar, Busy, Cover, Grok, Icon, Modal, Stack, Switch, VerifiedBadge } from './ui'
import { PactPage } from './PactPage'
import { AddExpense } from './TabCard'
import { BankCard } from './BankCard'
import { LiquidGold } from './LiquidGold'
import { AuthorizeMcp, ConnectPage, pendingMcpRequest } from './Mcp'
import { Landing } from './Landing'
import './luma.css'

type Profile = { name: string | null; email: string | null; avatar_url: string | null }

/** Everything the screens share, like the iOS PactStore. */
export type App = {
  me: string
  profile: Profile | null
  pacts: S.Pact[] | null
  data: Record<string, S.PactData>
  wallet: S.Wallet | null
  walletLoaded: boolean
  social: { requests: S.FriendRequest[]; friends: S.Member[]; invites: S.PactInvite[] }
  friends: { member: S.Member; pacts: S.Pact[] }[]
  name: (userId: string) => string
  avatar: (userId: string) => string | null
  go: (path: string) => void
  refresh: () => Promise<void>
  refreshPact: (id: string) => Promise<void>
  refreshSocial: () => Promise<void>
  setWallet: (w: S.Wallet | null) => void
  newPact: () => void
}

const Ctx = createContext<App>(null!)
export const useApp = () => useContext(Ctx)

export function LumaApp() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  useEffect(() => {
    S.supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = S.supabase.auth.onAuthStateChange((_e, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])
  if (session === undefined) return <div className="l-app"><div className="l-center"><img src="/pact-mark.png" alt="Pact" width={64} /><span className="l-spin" /></div></div>
  // Pact Pilot's "Continue with Google" lands here, signed in or not.
  if (location.pathname === '/connect/authorize' || pendingMcpRequest()) return <AuthorizeMcp session={session} />
  if (!session) return <Landing />
  return <Signed me={session.user.id} />
}

function SignIn() {
  const [busy, setBusy] = useState(false)
  return (
    <div className="l-app"><LiquidGold /><div className="l-signin">
      <img src="/pact-mark.png" alt="Pact" width={80} />
      <h1>Plan it in the chat. Pay before you book.</h1>
      <p>Your friends, your plans, and everyone's share, in one place.</p>
      <button className="l-btn" type="button" disabled={busy} onClick={() => { setBusy(true); void S.supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/` } }) }}>
        {busy ? 'Opening Google…' : 'Continue with Google'}
      </button>
    </div></div>
  )
}

function usePath() {
  const [path, setPath] = useState(location.pathname)
  useEffect(() => { const on = () => setPath(location.pathname); addEventListener('popstate', on); return () => removeEventListener('popstate', on) }, [])
  const go = useCallback((next: string) => { if (next !== location.pathname) history.pushState({}, '', next); setPath(next); scrollTo(0, 0); document.getElementById('l-scroll')?.scrollTo(0, 0) }, [])
  return [path, go] as const
}

function Signed({ me }: { me: string }) {
  const [path, go] = usePath()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [pacts, setPacts] = useState<S.Pact[] | null>(null)
  const [data, setData] = useState<Record<string, S.PactData>>({})
  const [wallet, setWallet] = useState<S.Wallet | null>(null)
  const [walletLoaded, setWalletLoaded] = useState(false)
  const [social, setSocial] = useState<App['social']>({ requests: [], friends: [], invites: [] })
  const [creating, setCreating] = useState(false)

  const refreshPact = useCallback(async (id: string) => {
    const d = await S.loadPactData(id, me)
    setData((all) => ({ ...all, [id]: d }))
  }, [me])
  const refresh = useCallback(async () => {
    const list = await S.loadPacts(me)
    setPacts(list)
    // Four pacts at a time, newest first, each showing as soon as its own data lands. Never the whole list at once.
    await S.inBatches(list, 4, async (p) => {
      const d = await S.loadPactData(p.pact_id, me).catch(() => null)
      if (d) setData((all) => ({ ...all, [p.pact_id]: d }))
    })
  }, [me])
  const refreshSocial = useCallback(async () => setSocial(await S.loadSocial()), [])

  useEffect(() => {
    void S.supabase.rpc('sync_my_google_profile')
    void S.supabase.from('profiles').select('name, email, avatar_url').eq('id', me).single().then(({ data: p }) => setProfile(p as Profile))
    void refresh()
    void refreshSocial()
    void S.loadWallet().then((w) => { setWallet(w); setWalletLoaded(true) })
  }, [me, refresh, refreshSocial])

  const friends = useMemo(() => {
    const byId = new Map<string, { member: S.Member; pacts: S.Pact[] }>()
    for (const m of social.friends) if (m.user_id !== me) byId.set(m.user_id, { member: m, pacts: [] })
    for (const p of pacts ?? []) for (const m of data[p.pact_id]?.members ?? []) {
      if (m.user_id === me) continue
      const f = byId.get(m.user_id) ?? { member: m, pacts: [] }
      f.pacts.push(p); byId.set(m.user_id, f)
    }
    return [...byId.values()].sort((a, b) => (a.member.name ?? '').localeCompare(b.member.name ?? ''))
  }, [social.friends, pacts, data, me])

  const name = useCallback((userId: string) => {
    if (userId === me) return 'You'
    for (const d of Object.values(data)) { const m = d.members.find((x) => x.user_id === userId); if (m?.name) return m.name }
    return 'Someone'
  }, [data, me])

  /** Someone's photo, from any pact we share or my friends list. */
  const avatar = useCallback((userId: string) => {
    if (userId === me) return profile?.avatar_url ?? null
    for (const d of Object.values(data)) { const m = d.members.find((x) => x.user_id === userId); if (m?.avatar_url) return m.avatar_url }
    return social.friends.find((f) => f.user_id === userId)?.avatar_url ?? null
  }, [data, me, profile, social.friends])

  const app: App = { me, profile, pacts, data, wallet, walletLoaded, social, friends, name, avatar, go, refresh, refreshPact, refreshSocial, setWallet, newPact: () => setCreating(true) }
  const parts = path.split('/').filter(Boolean)
  const tab = parts[0] === 'pacts' && parts[1] ? null : ['pacts', 'friends', 'wallet', 'grok'].includes(parts[0]) ? parts[0] : parts[0] === 'connect' ? 'grok' : 'home'

  return (
    <Ctx.Provider value={app}>
      <div className="l-app">
        <LiquidGold />
        <TopBar tab={tab} />
        {/* Only this area scrolls. The header above it never moves. On a pact, only the middle column scrolls. */}
        <div className={`l-scroll${parts[0] === 'pacts' && parts[1] ? ' pact' : ''}`} id="l-scroll">
        {parts[0] === 'pacts' && parts[1] ? <PactPage key={parts[1]} id={parts[1]} />
          : tab === 'pacts' ? <Timeline />
          : tab === 'friends' ? <Friends />
          : tab === 'wallet' ? <WalletPage />
          : tab === 'grok' ? <ConnectPage />
          : <Home />}
        </div>
        {tab && <BottomBar tab={tab} />}
        {creating && <NewPact onClose={() => setCreating(false)} />}
      </div>
    </Ctx.Provider>
  )
}

/** The iPhone app on TestFlight. Set VITE_TESTFLIGHT_URL (the public TestFlight link) in Vercel to show it. */
export const TESTFLIGHT_URL = (import.meta.env.VITE_TESTFLIGHT_URL as string | undefined) || null

const tabs = [
  { key: 'home', label: 'Home', icon: 'home', path: '/' },
  { key: 'pacts', label: 'Pacts', icon: 'pacts', path: '/pacts' },
  { key: 'friends', label: 'Friends', icon: 'friends', path: '/friends' },
  { key: 'wallet', label: 'Wallet', icon: 'wallet', path: '/wallet' },
  { key: 'grok', label: 'Grok Bot', icon: 'grok', path: '/grok' },
]

const tabIcon = (icon: string, size?: number) => (icon === 'grok' ? <img className="l-bot-icon" src="/grok-bot.png" alt="" width={size ?? 18} height={size ?? 18} /> : <Icon name={icon} size={size} />)

/** Phones: the tabs move to a glass bar at the bottom with a silver +, like the iOS app. */
/** What a pact is waiting on you for, in a line. Paying and releasing take your PIN. */
function needsText(w: S.Waiting) {
  if (w.what === 'approve') return 'Approve the plan so everyone can pay'
  if (w.what === 'pay') return `Pay your ${w.amount != null ? S.dollars(w.amount) + ' ' : ''}share with your PIN`
  if (w.what === 'release') return 'Everyone has paid: release it and book, with your PIN'
  return 'Everyone approved: set up the split and start collecting'
}

/** How many pacts are waiting on me, for the dot on the Pacts tab. */
function useNeedsMe() {
  const { me, pacts, data } = useApp()
  return (pacts ?? []).filter((p) => { const w = data[p.pact_id] ? S.waitingOn(data[p.pact_id]) : null; return Boolean(w && w.people.includes(me)) }).length
}

function BottomBar({ tab }: { tab: string | null }) {
  const { go, newPact, social } = useApp()
  const waiting = social.requests.filter((r) => r.incoming).length + social.invites.length
  const needs = useNeedsMe()
  return (
    <nav className="l-tabbar" aria-label="Main">
      <div className="l-tabbar-glass">
        {tabs.map((t) => (
          <button key={t.key} type="button" className={tab === t.key ? 'on' : ''} onClick={() => go(t.path)} aria-label={t.label} aria-current={tab === t.key ? 'page' : undefined}>
            {tabIcon(t.icon, 22)}
            {((t.key === 'friends' && waiting > 0) || (t.key === 'pacts' && needs > 0)) && <i className="l-tabbar-dot" />}
          </button>
        ))}
      </div>
      <button className="l-tabbar-plus" type="button" onClick={newPact} aria-label="New pact"><Icon name="plus" /></button>
    </nav>
  )
}

function TopBar({ tab }: { tab: string | null }) {
  const { go, profile, newPact, social } = useApp()
  // The header stays put; side columns sit just under it, so they read its real height into --top-h.
  const topRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = topRef.current
    if (!el) return
    const set = () => document.documentElement.style.setProperty('--top-h', `${el.offsetHeight}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const [now, setNow] = useState(new Date())
  const [menu, setMenu] = useState(false)
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t) }, [])
  const waiting = social.requests.filter((r) => r.incoming).length + social.invites.length
  const needs = useNeedsMe()
  return (
    <header className="l-top" ref={topRef}>
      <button className="l-mark" type="button" onClick={() => go('/')} style={{ border: 0, padding: 0, background: 'none' }} aria-label="Home"><img src="/pact-mark.png" alt="" /></button>
      <nav className="l-nav" aria-label="Main">
        {tabs.map((t) => (
          <button key={t.key} type="button" className={tab === t.key ? 'on' : ''} onClick={() => go(t.path)} aria-current={tab === t.key ? 'page' : undefined}>
            {tabIcon(t.icon)}<span>{t.label}</span>
            {((t.key === 'friends' && waiting > 0) || (t.key === 'pacts' && needs > 0)) && <i style={{ width: 7, height: 7, borderRadius: 9, background: 'var(--bad)', marginLeft: -2 }} />}
          </button>
        ))}
      </nav>
      <div className="l-right">
        <span className="l-time">{now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}</span>
        <button className="l-plus" type="button" onClick={newPact} aria-label="New pact" title="New pact"><Icon name="plus" /></button>
        <div className="l-menu-wrap">
          <button type="button" onClick={() => setMenu(!menu)} style={{ border: 0, background: 'none', padding: 0 }} aria-label="Your profile"><Avatar name={profile?.name} url={profile?.avatar_url} size={30} /></button>
          {menu && (
            <div className="l-menu" onMouseLeave={() => setMenu(false)}>
              <div><b>{profile?.name ?? 'You'}</b><span>{profile?.email}</span></div>
              {TESTFLIGHT_URL && <a href={TESTFLIGHT_URL} target="_blank" rel="noreferrer">Get the iPhone app</a>}
              <button type="button" onClick={() => void S.supabase.auth.signOut({ scope: 'local' })}>Sign out</button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

// ---- Home

function Home() {
  const { me, profile, pacts, data, social, go, refresh, refreshSocial, wallet, newPact } = useApp()
  // Home shows as soon as the list of pacts is in; totals fill in as each pact loads.
  if (pacts === null) return <div className="l-center"><span className="l-spin" /></div>
  const owe = pacts.reduce((sum, p) => sum + (data[p.pact_id] ? S.owedIn(data[p.pact_id], me) : 0), 0)
  const coming = pacts.reduce((sum, p) => sum + (data[p.pact_id] ? S.collectingIn(data[p.pact_id], me) : 0), 0)
  const upcoming = sortByDate(pacts).filter((p) => !isPast(p)).slice(0, 3)
  const needsMe = pacts.flatMap((p) => { const w = data[p.pact_id] ? S.waitingOn(data[p.pact_id]) : null; return w && w.people.includes(me) ? [{ pact: p, w }] : [] })
  const owedInNeeds = needsMe.some(({ w }) => w.what === 'pay')
  return (
    <main className="l-page">
      {/* What you came to do comes first: anything waiting on you, then what's next. Money is a line, not the hero. */}
      <div className="l-home-head">
        <div>
          <h1 className="l-h1">Hi, {S.firstName(profile?.name)}</h1>
        </div>
        <button className="l-plus big" type="button" onClick={newPact}><Icon name="plus" />New pact</button>
      </div>

      {/* Money first, in one line. The full card lives on the Wallet page. */}
      <button className="l-card l-home-money" type="button" onClick={() => go('/wallet')}>
        <span className="l-ledger-icon"><Icon name="wallet" /></span>
        <div className="l-row-main"><b>{wallet ? `${wallet.usdcBalance ?? '0.00'} USDC` : 'No wallet yet'}</b><span>{wallet ? 'Pact Money balance' : 'Make your wallet to pay and get paid'}</span></div>
        <div className="l-home-money-stats">
          {/* What you owe is already in Needs you, with its Pay button, so it isn't repeated here. */}
          {owe > 0 && !owedInNeeds && <span className="l-stat owe">You owe <b>{S.dollars(owe)}</b></span>}
          {coming > 0 && <span className="l-stat">Coming to you <b>{S.dollars(coming)}</b></span>}
          {owe === 0 && coming === 0 && <span className="l-stat ok"><Icon name="checkCircle" size={16} />Up to date</span>}
        </div>
        <span className="l-home-go" aria-hidden>›</span>
      </button>

      {needsMe.length > 0 ? <>
        <h2 className="l-h2">Needs you</h2>
        <div className="l-card l-list">
          {needsMe.map(({ pact, w }) => (
            <button className="l-row l-ledger-row" key={pact.pact_id} type="button" onClick={() => go(`/pacts/${pact.pact_id}`)}>
              <span className="l-waiting-grok"><Grok size={15} /></span>
              <div className="l-row-main"><b>{pact.name}</b><span>{needsText(w)}</span></div>
              <span className="l-btn l-small">{w.what === 'approve' ? 'Approve' : w.what === 'pay' ? 'Pay' : w.what === 'release' ? 'Release' : 'Start'}</span>
            </button>
          ))}
        </div>
      </> : pacts.length > 0 && !social.invites.length && (
        <div className="l-card l-home-calm"><Icon name="checkCircle" size={20} /><span>Nothing is waiting on you.{upcoming[0] ? <> Next up: <b>{upcoming[0].name}</b>.</> : ''}</span></div>
      )}

      {social.invites.length > 0 && <>
        <h2 className="l-h2">Asked in</h2>
        <div className="l-card l-list">
          {social.invites.map((inv) => (
            <div className="l-row" key={inv.pact_id}>
              <Avatar name={inv.inviter_name} url={inv.inviter_avatar_url} size={38} />
              <div className="l-row-main"><span>{S.firstName(inv.inviter_name)} asked you into</span><b>{inv.pact_name}</b></div>
              <span className="l-faint" style={{ fontSize: 13 }}>{inv.member_count} in</span>
              <button className="l-btn l-ghost l-small" type="button" onClick={async () => { await S.answerInvite(inv.pact_id, false); await refreshSocial() }}>Not now</button>
              <button className="l-btn l-small" type="button" onClick={async () => { await S.answerInvite(inv.pact_id, true); await Promise.all([refreshSocial(), refresh()]) }}>Join</button>
            </div>
          ))}
        </div>
      </>}

      <div className="l-head" style={{ margin: '34px 0 12px' }}>
        <h2 className="l-h2" style={{ margin: 0 }}>Coming up</h2>
        {pacts.length > 0 && <button className="l-link" type="button" onClick={() => go('/pacts')}>See all pacts</button>}
      </div>
      {!pacts.length ? <div className="l-card l-empty"><b>No pacts yet</b><span>Add your friends, then start a pact with them.</span></div>
        : <div style={{ display: 'grid', gap: 12 }}>{upcoming.map((p) => <PactCard key={p.pact_id} pact={p} />)}</div>}

    </main>
  )
}

// ---- Pacts timeline

const isPast = (p: S.Pact) => Boolean((p.ends_on ?? p.starts_on) && (p.ends_on ?? p.starts_on)! < S.today())
function sortByDate(list: S.Pact[]) {
  return [...list].sort((a, b) => (a.starts_on ?? '9999').localeCompare(b.starts_on ?? '9999') || b.created_at.localeCompare(a.created_at))
}

function Timeline() {
  const { pacts, data, newPact } = useApp()
  const [past, setPast] = useState(false)
  if (pacts === null) return <div className="l-center"><span className="l-spin" /></div>
  const shown = sortByDate(pacts).filter((p) => isPast(p) === past)
  if (past) shown.reverse()
  const groups: { key: string; day: string | null; pacts: S.Pact[] }[] = []
  for (const p of shown) {
    const key = p.starts_on ?? 'none'
    const g = groups.find((x) => x.key === key)
    if (g) g.pacts.push(p); else groups.push({ key, day: p.starts_on, pacts: [p] })
  }
  return (
    <main className="l-page">
      <div className="l-head">
        <h1 className="l-h1">Pacts</h1>
        <div className="l-head-actions">
        <div className="l-seg"><button type="button" className={!past ? 'on' : ''} onClick={() => setPast(false)}>Upcoming</button><button type="button" className={past ? 'on' : ''} onClick={() => setPast(true)}>Past</button></div>
        <button className="l-plus big" type="button" onClick={newPact}><Icon name="plus" /><span>New</span></button>
        </div>
      </div>
      {!shown.length && <div className="l-card l-empty"><b>{past ? 'No past pacts' : 'Nothing coming up'}</b><span>{past ? 'Pacts move here once their dates have gone by.' : 'Start a pact with your friends and give it dates.'}</span></div>}
      {groups.map((g) => (
        <section className="l-day" key={g.key}>
          <div className="l-when">
            {g.day ? <><b>{S.day(g.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</b><span>{S.day(g.day).toLocaleDateString('en-US', { weekday: 'long' })}</span></>
              : <><b>No dates yet</b><span>Still planning</span></>}
          </div>
          <div className="l-rail" />
          <div className="l-events">{g.pacts.map((p) => <PactCard key={p.pact_id} pact={p} loading={!data[p.pact_id]} />)}</div>
        </section>
      ))}
    </main>
  )
}

function whenLine(p: S.Pact) {
  if (!p.starts_on) return null
  const t = S.today()
  const end = p.ends_on ?? p.starts_on
  const range = S.dateRange(p.starts_on, p.ends_on)!
  if (p.starts_on <= t && end >= t) return <><span className="now">● Happening now</span> · {range}</>
  const days = Math.round((S.day(p.starts_on).getTime() - S.day(t).getTime()) / 864e5)
  if (days > 0 && days <= 7) return <>{range} · <span className="soon">{days === 1 ? 'Tomorrow' : `In ${days} days`}</span></>
  return <>{range}</>
}

export function PactCard({ pact, loading }: { pact: S.Pact; loading?: boolean }) {
  const { me, data, go, wallet } = useApp()
  const d = data[pact.pact_id]
  const kind = S.detailsOf(pact).kind
  const host = d && S.coordinator(d)
  const others = d?.members.filter((m) => m.user_id !== me && m.role !== 'host') ?? []
  const c = d ? S.chip(S.step(d, me, Boolean(wallet))) : null
  const proof = d ? S.verification(d) : null
  return (
    <button type="button" className="l-card l-event" onClick={() => go(`/pacts/${pact.pact_id}`)}>
      <div className="l-event-main">
        <div className="l-event-top">{whenLine(pact) ?? <>{S.cap(kind)}</>}</div>
        <h3>{pact.name}</h3>
        {host && <div className="l-meta"><Stack people={d.members} max={3} size={26} /><span>By {host.user_id === me ? 'you' : host.name ?? 'Someone'}{others.length ? ` · with ${others.slice(0, 2).map((m) => S.firstName(m.name)).join(', ')}${others.length > 2 ? ` & ${others.length - 2} more` : ''}` : ''}</span></div>}
        <div className="l-meta"><Icon name="pin" /><span>{pact.location || 'To be decided'}</span></div>
        <div className="l-event-foot">
          {c ? <span className={`l-chip ${c.tone}`}>{c.text}</span> : loading && <span className="l-chip mute">Loading…</span>}
          {proof && proof.level !== 'none' && <VerifiedBadge level={proof.level} compact />}
          {d && d.members.length > 0 && <Stack people={d.members} max={5} size={30} />}
        </div>
      </div>
      <Cover kind={kind} name={pact.name} />
    </button>
  )
}

// ---- Friends

function Friends() {
  const { social, friends, refreshSocial } = useApp()
  const [finding, setFinding] = useState(false)
  const incoming = social.requests.filter((r) => r.incoming)
  const sent = social.requests.filter((r) => !r.incoming)
  return (
    <main className="l-page">
      <div className="l-head"><h1 className="l-h1">Friends</h1><button className="l-btn" type="button" onClick={() => setFinding(true)}><Icon name="plus" size={16} />Find people</button></div>
      {incoming.length > 0 && <>
        <h2 className="l-h2">Requests</h2>
        <div className="l-card l-list">{incoming.map((r) => (
          <div className="l-row" key={r.request_id}>
            <Avatar name={r.name} url={r.avatar_url} size={38} />
            <div className="l-row-main"><b>{r.name ?? 'Someone'}</b><span>Wants to be friends</span></div>
            <button className="l-btn l-ghost l-small" type="button" onClick={async () => { await S.answerRequest(r.request_id, false); await refreshSocial() }}>Decline</button>
            <button className="l-btn l-small" type="button" onClick={async () => { await S.answerRequest(r.request_id, true); await refreshSocial() }}>Accept</button>
          </div>
        ))}</div>
      </>}
      {sent.length > 0 && <>
        <h2 className="l-h2">Sent</h2>
        <div className="l-card l-list">{sent.map((r) => (
          <div className="l-row" key={r.request_id}>
            <Avatar name={r.name} url={r.avatar_url} size={38} />
            <div className="l-row-main"><b>{r.name ?? 'Someone'}</b></div>
            <span className="l-faint" style={{ fontSize: 14, fontWeight: 600 }}>Requested</span>
          </div>
        ))}</div>
      </>}
      <h2 className="l-h2">Your friends</h2>
      {!friends.length ? <div className="l-card l-empty"><b>No friends yet</b><span>Add your friends here, then start a pact with them.</span></div> : (
        <div className="l-card l-list">{friends.map((f) => (
          <div className="l-row" key={f.member.user_id}>
            <Avatar name={f.member.name} url={f.member.avatar_url} size={38} />
            <div className="l-row-main"><b>{f.member.name ?? 'Someone'}</b><span>{f.pacts.length ? f.pacts.map((p) => p.name).join(' · ') : 'Friends'}</span></div>
          </div>
        ))}</div>
      )}
      {finding && <FindPeople onClose={() => setFinding(false)} />}
    </main>
  )
}

function FindPeople({ onClose }: { onClose: () => void }) {
  const { refreshSocial } = useApp()
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<S.PersonResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    clearTimeout(timer.current)
    if (q.trim().length < 2) { setRows(null); return }
    timer.current = window.setTimeout(() => {
      S.searchPeople(q.trim()).then((r) => { setRows(r); setError(null) }).catch((e) => setError(e.message))
    }, 300)
  }, [q])
  async function add(p: S.PersonResult) {
    try { await S.requestFriend(p.user_id); setRows((rs) => rs?.map((r) => r.user_id === p.user_id ? { ...r, status: p.status === 'asked_you' ? 'friend' : 'requested' } : r) ?? null); await refreshSocial() }
    catch (e) { setError((e as Error).message) }
  }
  return (
    <Modal title="Find people" onClose={onClose}>
      <input className="l-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" />
      <p className="l-faint" style={{ fontSize: 13 }}>Type at least two letters of their name, or their whole email.</p>
      {error && <p className="l-error">{error}</p>}
      {rows && !rows.length && <p className="l-dim" style={{ fontSize: 14 }}>Nobody on Pact matches that yet.</p>}
      {rows?.map((p) => (
        <div className="l-row" key={p.user_id}>
          <Avatar name={p.name} url={p.avatar_url} size={36} />
          <div className="l-row-main"><b>{p.name ?? 'Someone'}</b></div>
          {p.status === 'friend' ? <span style={{ color: 'var(--go)', fontWeight: 600, fontSize: 14 }}>Friends</span>
            : p.status === 'requested' ? <span className="l-faint" style={{ fontWeight: 600, fontSize: 14 }}>Requested</span>
            : <button className="l-btn l-small" type="button" onClick={() => void add(p)}>{p.status === 'asked_you' ? 'Accept' : 'Add'}</button>}
        </div>
      ))}
    </Modal>
  )
}

// ---- Wallet

function WalletPage() {
  const { wallet, walletLoaded, setWallet, me, name, avatar, profile } = useApp()
  const { pacts } = useApp()
  const [ledger, setLedger] = useState<S.Ledger | null>(null)
  const [ledgerError, setLedgerError] = useState<string | null>(null)
  const [tagged, setTagged] = useState<Map<string, string>>(new Map())
  const [splitting, setSplitting] = useState<S.LedgerRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const pactKey = pacts === null ? null : pacts.map((p) => p.pact_id).join(',')
  const [attempt, setAttempt] = useState(0)
  const latestLoad = useRef(0)
  // Waits for the pact list (so friends' names are known), and only the newest load is shown,
  // so a slower, older load can never overwrite a newer one.
  useEffect(() => {
    if (!wallet || pactKey === null) return
    const run = ++latestLoad.current
    setLedgerError(null)
    S.loadLedger(wallet.address, pactKey ? pactKey.split(',') : [])
      .then((l) => { if (run === latestLoad.current) setLedger(l) })
      .catch((e) => { if (run === latestLoad.current) setLedgerError((e as Error).message) })
    // Which payments are already on a pact's tab. If this fails, the list still shows, just without the tags.
    void S.loadTaggedPayments().then(setTagged).catch(() => undefined)
  }, [wallet?.address, wallet?.usdcBalance, pactKey, attempt])
  if (!walletLoaded) return <div className="l-center"><span className="l-spin" /></div>
  return (
    <main className="l-page">
      <div className="l-head"><h1 className="l-h1">Wallet</h1></div>
      {wallet ? (
        <BankCard finish="pick" info={{ balance: wallet.usdcBalance, address: wallet.address, name: profile?.name ?? null }} footer={
          <div className="l-card-stats">
            <code className="l-dim" style={{ fontSize: 14 }}>{wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}</code>
            <button className="l-btn l-ghost l-small" type="button" onClick={() => { void navigator.clipboard.writeText(wallet.address); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>{copied ? 'Copied' : 'Copy address'}</button>
            <a className="l-btn l-ghost l-small" href="https://faucet.circle.com" target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>Get free test USDC</a>
          </div>
        } />
      ) : (
        <div className="l-card l-balance">
          <span className="l-dim" style={{ fontWeight: 600 }}>Arc Testnet</span>
          <p style={{ margin: '6px 0 12px', fontSize: 16 }}>Make a wallet so you can send and get test USDC. Circle keeps it safe with your own PIN.</p>
          <div>{busy ? <Busy text="Set your PIN…" /> : <button className="l-btn" type="button" onClick={async () => { setBusy(true); setError(null); try { setWallet(await S.makeWallet()) } catch (e) { setError((e as Error).message) } setBusy(false) }}>Make my wallet</button>}</div>
          {error && <p className="l-error">{error}</p>}
        </div>
      )}
      <h2 className="l-h2">Activity</h2>
      {!wallet ? <div className="l-card l-empty"><span>Make your wallet to see money coming in and going out.</span></div>
        : ledgerError && !ledger ? <div className="l-card l-empty"><span>{ledgerError}</span><div><button className="l-btn l-ghost l-small" type="button" onClick={() => setAttempt((n) => n + 1)}>Try again</button></div></div>
        : !ledger ? <div className="l-card l-empty"><span className="l-spin" style={{ margin: '0 auto' }} /></div>
        : !ledger.rows.length ? <div className="l-card l-empty"><span>Money you send and get shows up here.</span></div> : (
        <div className="l-card l-list">
          {ledger.rows.map((r) => <LedgerLine key={r.id} row={r} taggedTo={tagged.get(r.txHash.toLowerCase()) ?? null} onSplit={() => setSplitting(r)} />)}
          {ledger.fees > 0 && (
            <div className="l-row">
              <span className="l-ledger-icon"><Icon name="other" /></span>
              <div className="l-row-main"><b>Network fees</b><span>Arc charges a tiny fee in USDC for each payment you send</span></div>
              <b className="l-amt">−{ledger.fees.toFixed(4)}</b>
            </div>
          )}
          <div className="l-row l-ledger-total">
            <div className="l-row-main"><b>Balance</b><span>Everything above, added up</span></div>
            <b className="l-amt">{(Math.floor(ledger.total * 100) / 100).toFixed(2)} USDC</b>
          </div>
        </div>
      )}
      {splitting && <SplitPayment row={splitting} onClose={() => setSplitting(null)} onDone={() => { setSplitting(null); void S.loadTaggedPayments().then(setTagged) }} />}
    </main>
  )
}

/** Put a wallet payment on a pact's tab: pick the pact, then who it was for. */
function SplitPayment({ row, onClose, onDone }: { row: S.LedgerRow; onClose: () => void; onDone: () => void }) {
  const { pacts, me } = useApp()
  const [pactId, setPactId] = useState<string | null>(null)
  const [members, setMembers] = useState<S.Member[] | null>(null)
  useEffect(() => { if (pactId) void S.loadMembers(pactId).then(setMembers) }, [pactId])
  if (pactId && members) return <AddExpense id={pactId} me={me} members={members} txHash={row.txHash} amountCents={Math.round(row.amount * 100)} onClose={onClose} onDone={onDone} />
  return (
    <Modal title="Which pact was it for?" onClose={onClose}>
      <div className="l-list">
        {(pacts ?? []).map((p) => (
          <button key={p.pact_id} type="button" className="l-row l-ledger-row" disabled={Boolean(pactId)} onClick={() => setPactId(p.pact_id)}>
            <span className="l-ledger-icon pact"><Icon name={S.detailsOf(p).kind} /></span>
            <div className="l-row-main"><b>{p.name}</b><span>{p.location ?? 'Add it to this tab'}</span></div>
          </button>
        ))}
      </div>
      {pactId && <Busy text="Loading the pact…" />}
    </Modal>
  )
}

function LedgerLine({ row, taggedTo, onSplit }: { row: S.LedgerRow; taggedTo: string | null; onSplit: () => void }) {
  const { name, avatar, pacts, go } = useApp()
  const short = `${row.address.slice(0, 6)}…${row.address.slice(-4)}`
  const pact = row.pactId ? pacts?.find((p) => p.pact_id === row.pactId) ?? null : null
  const title = row.kind === 'person' ? `${row.incoming ? 'From' : 'To'} ${name(row.userId!)}`
    : row.kind === 'share' ? `Paid your share into ${pact?.name ?? 'a pact'}`
    : row.kind === 'payout' ? `Paid out from ${pact?.name ?? 'a pact'}`
    : row.kind === 'deposit' ? 'Test USDC added'
    : `Sent to ${short}`
  const when = new Date(row.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const body = (
    <>
      {row.kind === 'person' ? <Avatar name={name(row.userId!)} url={avatar(row.userId!)} size={40} />
        : pact ? <span className="l-ledger-icon pact"><Icon name={S.detailsOf(pact).kind} /></span>
        : <span className={`l-ledger-icon ${row.incoming ? 'in' : 'out'}`}><Icon name={row.incoming ? 'up' : 'down'} /></span>}
      <div className="l-row-main"><b>{title}</b><span>{when}{row.kind === 'deposit' ? ` · from ${short}` : pact ? ' · open the pact' : ''}</span></div>
      <b className="l-amt" style={row.incoming ? { color: 'var(--go)' } : undefined}>{row.incoming ? '+' : '−'}{row.amount.toFixed(2)}</b>
    </>
  )
  // A payment to anyone outside the app (a shop, a host) can go on a pact's tab and split.
  if (row.kind === 'address' && !row.incoming) {
    const tab = taggedTo ? pacts?.find((p) => p.pact_id === taggedTo) ?? null : null
    return (
      <div className="l-row l-ledger-row">
        {body}
        {tab
          ? <button className="l-btn l-ghost l-small" type="button" onClick={() => go(`/pacts/${tab.pact_id}`)}>On {tab.name}'s tab</button>
          : <button className="l-btn l-small" type="button" onClick={onSplit}>Split it</button>}
      </div>
    )
  }
  // A pact payment opens that pact; everything else opens the transaction on the Arc explorer.
  return pact
    ? <button type="button" className="l-row l-ledger-row" onClick={() => go(`/pacts/${pact.pact_id}`)} title={`Open ${pact.name}`}>{body}</button>
    : <a className="l-row l-ledger-row" href={S.txLink(row.txHash)} target="_blank" rel="noreferrer" title="See it on the Arc explorer">{body}</a>
}

// ---- New pact

export function DetailsForm({ value, onChange }: { value: S.Details; onChange: (d: S.Details) => void }) {
  const set = (patch: Partial<S.Details>) => onChange({ ...value, ...patch })
  const hasDates = Boolean(value.startsOn)
  return (
    <>
      <div className="l-field"><span>Kind</span>
        <div className="l-kinds">{S.pactKinds.map((k) => <button key={k} type="button" className={value.kind === k ? 'on' : ''} onClick={() => set({ kind: k })}><Icon name={k} />{S.cap(k)}</button>)}</div>
      </div>
      <label className="l-field"><span>What it is</span><textarea className="l-input" value={value.about} onChange={(e) => set({ about: e.target.value })} placeholder="A weekend in Austin for the conference" /></label>
      <label className="l-field"><span>Where</span><input className="l-input" value={value.location} onChange={(e) => set({ location: e.target.value })} placeholder="Austin, Texas" /></label>
      <Switch on={hasDates} label="Dates" onChange={(on) => set(on ? { startsOn: S.today(), endsOn: S.today() } : { startsOn: null, endsOn: null })} />
      {hasDates && <div className="l-two">
        <label className="l-field"><span>From</span><input className="l-input" type="date" value={value.startsOn ?? ''} onChange={(e) => set({ startsOn: e.target.value, endsOn: value.endsOn && value.endsOn < e.target.value ? e.target.value : value.endsOn })} /></label>
        <label className="l-field"><span>To</span><input className="l-input" type="date" value={value.endsOn ?? ''} min={value.startsOn ?? undefined} onChange={(e) => set({ endsOn: e.target.value })} /></label>
      </div>}
      <div className="l-two">
        <label className="l-field"><span>Budget each</span><input className="l-input" inputMode="decimal" value={value.budget ?? ''} onChange={(e) => set({ budget: e.target.value === '' ? null : Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })} placeholder="$" /></label>
        <label className="l-field"><span>Link</span><input className="l-input" value={value.link} onChange={(e) => set({ link: e.target.value })} placeholder="airbnb.com/…" /></label>
      </div>
    </>
  )
}

const blankDetails = (): S.Details => ({ kind: 'trip', about: '', location: '', startsOn: null, endsOn: null, budget: null, link: '' })

function NewPact({ onClose }: { onClose: () => void }) {
  const { friends, go, refresh } = useApp()
  const [name, setName] = useState('')
  const [details, setDetails] = useState(blankDetails)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function create() {
    setBusy(true); setError(null)
    try { const id = await S.createPact(name, details, picked); await refresh(); onClose(); go(`/pacts/${id}`) }
    catch (e) { setError((e as Error).message); setBusy(false) }
  }
  return (
    <Modal title="New pact" onClose={onClose}>
      <form className="l-form" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void create() }}>
        <label className="l-field"><span>Name</span><input className="l-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Austin weekend" maxLength={80} /></label>
        <DetailsForm value={details} onChange={setDetails} />
        <div className="l-field"><span>Friends</span>
          {!friends.length ? <p className="l-faint" style={{ margin: 0, fontSize: 14 }}>Add friends in the Friends tab first.</p>
            : friends.map((f) => {
              const on = picked.includes(f.member.user_id)
              return (
                <button key={f.member.user_id} type="button" className="l-pick" onClick={() => setPicked(on ? picked.filter((x) => x !== f.member.user_id) : [...picked, f.member.user_id])}>
                  <Avatar name={f.member.name} url={f.member.avatar_url} size={30} /><b>{f.member.name ?? 'Someone'}</b>
                  <span className={on ? 'l-check on' : 'l-check'}>{on && <Icon name="check" />}</span>
                </button>
              )
            })}
        </div>
        {error && <p className="l-error">{error}</p>}
        <button className="l-btn l-wide-btn" type="submit" disabled={busy || !name.trim()}>{busy ? 'Creating…' : picked.length ? `Create and ask ${picked.length} in` : 'Create pact'}</button>
      </form>
    </Modal>
  )
}
