import { useEffect, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { hasSupabaseConfig, supabase } from '../lib/supabase'
import { createPact, friendlyError, listPactMembers, listPacts, requestJoinPact } from '../lib/pactService'
import { getPactMoneyWalletStatus, getPactPaymentStatus } from '../lib/pactMoneyService'
import type { PactSummary } from '../types/pact'
import type { PactPaymentStatusRow } from '../types/pactMoney'
import type { PactMoneyWallet } from '../types/pactMoney'
import { TripScreen } from './TripScreen'
import { money } from './trip'

type Route =
  | { kind: 'home' } | { kind: 'friends' } | { kind: 'you' }
  | { kind: 'new' } | { kind: 'join'; invite: string } | { kind: 'trip'; id: string }

function parse(path: string): Route {
  const url = new URL(path, window.location.origin)
  const parts = url.pathname.split('/').filter(Boolean)
  if (url.pathname === '/friends') return { kind: 'friends' }
  if (url.pathname === '/you') return { kind: 'you' }
  if (url.pathname === '/trips/new' || url.pathname === '/pacts/create') return { kind: 'new' }
  if (url.pathname === '/pacts/join' || url.pathname === '/join') return { kind: 'join', invite: url.searchParams.get('invite') || '' }
  if (parts[0] === 'pacts' && parts[1]) return { kind: 'trip', id: parts[1] }
  return { kind: 'home' }
}

const PENDING_INVITE = 'pact.pendingInvite'
const remember = (invite: string) => { try { sessionStorage.setItem(PENDING_INVITE, invite) } catch { /* private mode */ } }
const takeRemembered = () => { try { const v = sessionStorage.getItem(PENDING_INVITE); sessionStorage.removeItem(PENDING_INVITE); return v } catch { return null } }

export type Go = (path: string, replace?: boolean) => void

export function SimpleApp() {
  const [path, setPath] = useState(() => window.location.pathname + window.location.search)
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(!supabase)
  const go: Go = (next, replace = false) => { if (replace) history.replaceState({}, '', next); else history.pushState({}, '', next); setPath(next); window.scrollTo(0, 0) }

  useEffect(() => { const onPop = () => setPath(window.location.pathname + window.location.search); addEventListener('popstate', onPop); return () => removeEventListener('popstate', onPop) }, [])
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setReady(true) })
    return () => data.subscription.unsubscribe()
  }, [])

  const route = parse(path)
  const user = session?.user ?? null

  // An invite link opened while signed out survives the Google round trip, then lands in the join screen.
  useEffect(() => {
    if (!ready) return
    if (!user && route.kind === 'join' && route.invite) remember(route.invite)
    if (user) { const pending = takeRemembered(); if (pending) go(`/pacts/join?invite=${encodeURIComponent(pending)}`, true) }
  }, [ready, user?.id])

  if (!ready) return <Frame><div className="s-center"><Logo big /></div></Frame>
  if (!user) return <Frame><SignIn invited={route.kind === 'join' && Boolean(route.invite)} /></Frame>

  const tab = route.kind === 'friends' ? 'friends' : route.kind === 'you' ? 'you' : route.kind === 'home' ? 'home' : null
  return (
    <Frame tabs={tab ? <Tabs tab={tab} go={go} /> : null}>
      {route.kind === 'home' && <Home user={user} go={go} />}
      {route.kind === 'friends' && <Friends user={user} go={go} />}
      {route.kind === 'you' && <You user={user} />}
      {route.kind === 'new' && <NewTrip go={go} />}
      {route.kind === 'join' && <Join invite={route.invite} go={go} />}
      {route.kind === 'trip' && <TripScreen id={route.id} user={user} go={go} />}
    </Frame>
  )
}

function Frame({ children, tabs }: { children: ReactNode; tabs?: ReactNode }) {
  return <div className="s-stage"><div className="s-phone"><div className="s-scroll">{children}</div>{tabs}</div></div>
}

export function Logo({ big = false }: { big?: boolean }) {
  return <span className={big ? 's-logo s-logo-big' : 's-logo'}><img src="/pact-logo.png" alt="" />Pact</span>
}

export function Avatar({ name, url, size = 32 }: { name?: string | null; url?: string | null; size?: number }) {
  const style = { width: size, height: size, fontSize: size * 0.42 }
  return url ? <img className="s-av" style={style} src={url} alt="" referrerPolicy="no-referrer" /> : <span className="s-av" style={style}>{(name || '?').charAt(0).toUpperCase()}</span>
}

export function Header({ title, back, go, right }: { title: string; back?: string; go?: Go; right?: ReactNode }) {
  return (
    <header className="s-head">
      <div className="s-head-row">
        {back && go ? <button className="s-back" type="button" onClick={() => go(back)} aria-label="Back">‹</button> : <Logo />}
        {right}
      </div>
      <h1>{title}</h1>
    </header>
  )
}

const tabs = [
  { key: 'home', label: 'Home', path: '/dashboard', icon: <path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1z" /> },
  { key: 'friends', label: 'Friends', path: '/friends', icon: <><circle cx="9" cy="9" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><circle cx="16.5" cy="9.5" r="2.4" /><path d="M16 14a4.5 4.5 0 0 1 4.5 5" /></> },
  { key: 'you', label: 'You', path: '/you', icon: <><circle cx="12" cy="9" r="3.6" /><path d="M5 20a7 7 0 0 1 14 0" /></> },
] as const

function Tabs({ tab, go }: { tab: string; go: Go }) {
  return (
    <nav className="s-tabs" aria-label="Main">
      {tabs.map((t) => (
        <button key={t.key} type="button" className={tab === t.key ? 'on' : ''} onClick={() => go(t.path)} aria-current={tab === t.key ? 'page' : undefined}>
          <svg viewBox="0 0 24 24" aria-hidden="true">{t.icon}</svg>
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  )
}

function SignIn({ invited }: { invited: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function signIn() {
    if (!supabase) { setError('Pact is not connected to Supabase yet.'); return }
    setBusy(true)
    const { error: authError } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}${import.meta.env.VITE_POST_AUTH_REDIRECT || '/dashboard'}` } })
    if (authError) { setError(authError.message); setBusy(false) }
  }
  return (
    <div className="s-signin">
      <Logo big />
      <h1>{invited ? 'Your friends started a trip.' : 'Plan it in the chat. Pay before you book.'}</h1>
      <p>{invited ? 'Sign in to see who’s going and what’s been decided.' : 'One place for the group to agree, vote and each pay their share.'}</p>
      <button className="s-btn s-btn-wide" type="button" onClick={signIn} disabled={busy || !hasSupabaseConfig}>{busy ? 'Opening Google…' : 'Continue with Google'}</button>
      {error && <p className="s-error" role="alert">{error}</p>}
    </div>
  )
}

type TripRow = PactSummary & { rows: PactPaymentStatusRow[] }

function tripLine(trip: TripRow, me: string): { text: string; tone: 'gold' | 'ok' | 'mute'; owe: number } {
  const first = trip.rows[0]
  if (!first) return { text: 'Planning', tone: 'mute', owe: 0 }
  const paid = trip.rows.filter((r) => r.share_status === 'paid').length
  const share = Number(first.share_usdc)
  if (first.payment_status === 'released') return { text: 'Booked', tone: 'ok', owe: 0 }
  if (first.payment_status === 'cancelled') return { text: 'Cancelled', tone: 'mute', owe: 0 }
  if (first.payment_status === 'none') return { text: 'Pot not open yet', tone: 'mute', owe: 0 }
  const mine = trip.rows.find((r) => r.user_id === me)
  if (mine && mine.share_status === 'owed') return { text: `Pay $${money(share)}`, tone: 'gold', owe: share }
  return { text: `${paid} of ${first.shares_needed} paid`, tone: 'mute', owe: 0 }
}

function Home({ user, go }: { user: User; go: Go }) {
  const [trips, setTrips] = useState<TripRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    listPacts(user.id)
      .then((pacts) => Promise.all(pacts.map(async (p) => ({ ...p, rows: await getPactPaymentStatus(p.id).catch(() => []) }))))
      .then((rows) => { if (live) setTrips(rows) })
      .catch((reason) => { if (live) setError(friendlyError(reason, 'Your trips could not be loaded.')) })
    return () => { live = false }
  }, [user.id])
  const lines = (trips ?? []).map((t) => ({ trip: t, line: tripLine(t, user.id) }))
  const owe = lines.reduce((sum, l) => sum + l.line.owe, 0)
  const owing = lines.filter((l) => l.line.owe > 0).length
  const first = (user.user_metadata?.full_name || user.user_metadata?.name || '').split(' ')[0]

  return (
    <>
      <Header title={first ? `Hi, ${first}` : 'Your trips'} right={<Avatar name={first} url={user.user_metadata?.avatar_url} size={36} />} />
      <section className="s-card s-card-gold">
        <span className="s-lab">You owe</span>
        <div className="s-row s-between"><b className="s-big">${money(owe)}</b><span className="s-mute">{owing ? `${owing} ${owing === 1 ? 'trip' : 'trips'}` : 'All settled'}</span></div>
      </section>
      <div className="s-row">
        <button className="s-btn" type="button" onClick={() => go('/trips/new')}>New trip</button>
        <button className="s-btn s-ghost" type="button" onClick={() => go('/pacts/join')}>Join with a code</button>
      </div>
      <h2 className="s-h2">Your trips</h2>
      {error && <p className="s-error" role="alert">{error}</p>}
      {!trips && !error && <p className="s-mute">Loading your trips…</p>}
      {trips && !trips.length && <div className="s-empty"><b>No trips yet</b><span>Start one and paste the link in your group chat.</span></div>}
      <div className="s-list">
        {lines.map(({ trip, line }) => (
          <button key={trip.id} type="button" className="s-trip" onClick={() => go(`/pacts/${trip.id}`)}>
            <span className="s-trip-main"><b>{trip.name}</b><small>{trip.member_count ?? 1} going</small></span>
            <span className={`s-pill ${line.tone}`}>{line.text}</span>
          </button>
        ))}
      </div>
    </>
  )
}

function NewTrip({ go }: { go: Go }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function create() {
    setBusy(true); setError(null)
    try { const { id } = await createPact(name); go(`/pacts/${id}?invite=1`, true) }
    catch (reason) { setError(friendlyError(reason, 'The trip could not be created.')); setBusy(false) }
  }
  return (
    <>
      <Header title="New trip" back="/dashboard" go={go} />
      <form className="s-form" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void create() }}>
        <label htmlFor="trip-name">Trip name</label>
        <input id="trip-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Austin · ACL weekend" autoFocus maxLength={80} />
        <p className="s-mute">Next you’ll get a link to paste into your group chat. Grok reads the chat in Pact, so nobody fills in a form.</p>
        {error && <p className="s-error" role="alert">{error}</p>}
        <button className="s-btn s-btn-wide" type="submit" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create trip'}</button>
      </form>
    </>
  )
}

function Join({ invite, go }: { invite: string; go: Go }) {
  const [code, setCode] = useState(invite)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function join(value = code) {
    setBusy(true); setError(null)
    try { const id = await requestJoinPact({ invitation: value }); go(`/pacts/${id}`, true) }
    catch (reason) { setError(friendlyError(reason, 'That code didn’t work. Ask for a new link.')); setBusy(false) }
  }
  return (
    <>
      <Header title="Join a trip" back="/dashboard" go={go} />
      <form className="s-form" onSubmit={(e) => { e.preventDefault(); if (code.trim()) void join() }}>
        <label htmlFor="join-code">Invite code</label>
        <input id="join-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="abc12345" autoFocus autoCapitalize="none" />
        <p className="s-mute">Codes last 24 hours. Ask whoever started the trip for a fresh link if it’s expired.</p>
        {error && <p className="s-error" role="alert">{error}</p>}
        <button className="s-btn s-btn-wide" type="submit" disabled={busy || !code.trim()}>{busy ? 'Joining…' : 'Join the trip'}</button>
      </form>
    </>
  )
}

type Person = { id: string; name: string; avatar: string | null; trips: string[] }
type Chat = { id: string; name: string; last: string | null; count: number }

function Friends({ user, go }: { user: User; go: Go }) {
  const [data, setData] = useState<{ chats: Chat[]; people: Person[] } | null>(null)
  useEffect(() => {
    let live = true
    ;(async () => {
      const pacts = await listPacts(user.id)
      const people = new Map<string, Person>()
      const chats = await Promise.all(pacts.map(async (pact) => {
        const [members, last] = await Promise.all([
          listPactMembers(pact.id).catch(() => []),
          supabase ? supabase.from('pact_messages').select('body').eq('pact_id', pact.id).order('created_at', { ascending: false }).limit(1) : null,
        ])
        for (const m of members) {
          if (m.user_id === user.id) continue
          const person = people.get(m.user_id) ?? { id: m.user_id, name: m.name || 'A friend', avatar: m.avatar_url ?? null, trips: [] }
          person.trips.push(pact.name)
          people.set(m.user_id, person)
        }
        return { id: pact.id, name: pact.name, last: (last?.data?.[0]?.body as string | undefined) ?? null, count: members.length }
      }))
      if (live) setData({ chats, people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)) })
    })().catch(() => { if (live) setData({ chats: [], people: [] }) })
    return () => { live = false }
  }, [user.id])

  return (
    <>
      <Header title="Friends" />
      {!data && <p className="s-mute">Loading…</p>}
      {data && <>
        <h2 className="s-h2">Group chats</h2>
        {!data.chats.length && <div className="s-empty"><b>No group chats yet</b><span>Every trip gets its own chat with Grok in it.</span></div>}
        <div className="s-list">
          {data.chats.map((c) => (
            <button key={c.id} type="button" className="s-trip" onClick={() => go(`/pacts/${c.id}#chat`)}>
              <span className="s-trip-main"><b>{c.name}</b><small>{c.last ?? 'Say hi to the group.'}</small></span>
              <span className="s-mute s-num">{c.count}</span>
            </button>
          ))}
        </div>
        <h2 className="s-h2">People</h2>
        {!data.people.length && <div className="s-empty"><b>Nobody here yet</b><span>People you share a trip with show up here.</span></div>}
        <div className="s-list">
          {data.people.map((p) => (
            <div key={p.id} className="s-person">
              <Avatar name={p.name} url={p.avatar} size={40} />
              <span className="s-trip-main"><b>{p.name}</b><small>{p.trips.join(' · ')}</small></span>
            </div>
          ))}
        </div>
      </>}
    </>
  )
}

function You({ user }: { user: User }) {
  const [wallet, setWallet] = useState<PactMoneyWallet | null | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const name = user.user_metadata?.full_name || user.user_metadata?.name || 'You'
  useEffect(() => { if (open && wallet === undefined) getPactMoneyWalletStatus().then(setWallet).catch(() => setWallet(null)) }, [open])
  return (
    <>
      <Header title="You" />
      <section className="s-profile">
        <Avatar name={name} url={user.user_metadata?.avatar_url} size={72} />
        <b>{name}</b>
        <span className="s-mute">{user.email}</span>
      </section>
      <section className="s-card">
        <button className="s-disclose" type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span>Payment details</span><span>{open ? '−' : '+'}</span>
        </button>
        {open && (wallet === undefined ? <p className="s-mute">Loading…</p> : wallet ? (
          <div className="s-kv">
            <span>Balance</span><b className="s-num">${wallet.usdcBalance ?? '—'}</b>
            <span>Wallet</span><code>{wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}</code>
            <span>Network</span><span>Arc test network</span>
          </div>
        ) : <p className="s-mute">You’ll set a PIN the first time you pay your share.</p>)}
      </section>
      <button className="s-btn s-ghost s-btn-wide" type="button" onClick={() => void supabase?.auth.signOut()}>Sign out</button>
    </>
  )
}
