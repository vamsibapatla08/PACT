import { useEffect, useState } from 'react'
import * as S from './store'
import { BankCard } from './BankCard'
import { LiquidGold } from './LiquidGold'
import { GROK_BOT_URL, GrokBotGuide, ToolGrid } from './Mcp'
import { Avatar, Grok, Icon, VerifiedBadge } from './ui'

// Everything below is the real Pact UI with made-up data. John is the coordinator; the friends are fictional.
const people = {
  rory: { name: 'John', initial: 'J', tone: '#c9cbd1' },
  maya: { name: 'Maya', initial: 'M', tone: '#8fa8ff' },
  jordan: { name: 'Jordan', initial: 'J', tone: '#ffb38a' },
  sam: { name: 'Sam', initial: 'S', tone: '#7fe0b0' },
}
type Who = keyof typeof people

function Face({ who, size = 28 }: { who: Who; size?: number }) {
  const p = people[who]
  return <span className="x-face" style={{ width: size, height: size, fontSize: size * 0.42, background: `linear-gradient(160deg, ${p.tone}, #2a2c33)` }}>{p.initial}</span>
}
function Faces({ who, size = 26 }: { who: Who[]; size?: number }) {
  return <span className="l-stack">{who.map((w) => <Face key={w} who={w} size={size} />)}</span>
}

function GoogleG({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

/** Google sign-in. `to` is where Google sends you back; the app's home by default. */
export function GoogleButton({ big, to, onStart }: { big?: boolean; to?: string; onStart?: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <button className={big ? 'x-google big' : 'x-google'} type="button" disabled={busy}
      onClick={() => { setBusy(true); onStart?.(); void S.supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: to ?? `${location.origin}/` } }) }}>
      <GoogleG size={big ? 20 : 17} />{busy ? 'Opening Google…' : 'Continue with Google'}
    </button>
  )
}

export function Landing() {
  const testflight = import.meta.env.VITE_TESTFLIGHT_URL as string | undefined
  return (
    <div className="l-app x-landing">
      <LiquidGold />
      <header className="x-top">
        <a className="x-brand" href="/"><img src="/pact-mark.png" alt="" /><b>Pact</b></a>
        <nav className="x-links">
          <a href="#how">How it works</a>
          <a href="#pilot">Pact Pilot</a>
          <a href="#trust">Your money</a>
          <a href="#grokbot" className="x-link-bot"><img src="/grok-bot.png" alt="" />Grok Bot</a>
          <a href="#app">The app</a>
        </nav>
        <a href="#grokbot" className="x-bot-tab" aria-label="Grok Bot"><img src="/grok-bot.png" alt="" /></a>
        <GoogleButton />
      </header>

      {/* 1. Hero: what Pact is in five seconds, and the whole flow playing on the right. */}
      <section className="x-hero">
        <div className="x-hero-copy">
          <span className="x-kicker">Group trips, paid up front</span>
          <h1>The group chat that actually books the trip.</h1>
          <p>Plan it together, everyone pays their share up front, then you book. No chasing friends, no fronting the money.</p>
          <div className="x-hero-actions">
            <GoogleButton big />
            {testflight && <a className="x-testflight" href={testflight} target="_blank" rel="noreferrer">Get the iPhone app</a>}
          </div>
        </div>
        <div className="x-hero-card"><LoopingPact /></div>
      </section>

      {/* 2. The problem everyone has lived through. */}
      <section className="x-section x-problem">
        <h2>Sound familiar?</h2>
        <div className="x-pains">
          <div className="l-card x-pain"><span className="x-quote">“I’ll pay you back”</span><p>…and they never do.</p></div>
          <div className="l-card x-pain"><span className="x-quote">One person books the Airbnb</span><p>…then spends a month chasing everyone for their share.</p></div>
          <div className="l-card x-pain"><span className="x-quote">The trip dies in the group chat</span><p>…because nobody commits until someone pays.</p></div>
        </div>
        <p className="x-fix">Pact fixes that.</p>
      </section>

      {/* 3. How it works, in four plain steps. */}
      <section id="how" className="x-section">
        <h2>How it works</h2>
        <div className="x-steps">
          <Step n={1} title="Plan" line="Talk it through. Pact Pilot finds options and puts them to a vote.">
            <div className="x-chat">
              <div className="x-msg"><Face who="maya" size={24} /><span>Found a house on South Congress, $142 each?</span></div>
              <div className="x-msg me"><span>In. Add the ACL passes too</span></div>
            </div>
            <div className="x-items">
              <div><Icon name="stay" size={15} /><b>South Congress house</b><span>$142</span></div>
              <div><Icon name="ticket" size={15} /><b>ACL 3-day pass</b><span>$165</span></div>
            </div>
          </Step>
          <Step n={2} title="Approve" line="Everyone signs off on the plan and the price.">
            <div className="x-mini-card">
              <Faces who={['rory', 'maya', 'jordan', 'sam']} />
              <b>Austin ACL weekend</b>
              <span className="l-dim">$307 each · 3 of 4 approved</span>
              <div className="x-mini-actions"><span className="x-btn">Approve</span><span className="x-btn ghost">Not yet</span></div>
            </div>
          </Step>
          <Step n={3} title="Pay" line="Each person pays their share with their own PIN. The money’s held until everyone’s in.">
            <div className="x-mini-card">
              <b>Approve your share</b>
              <div className="l-progress"><i style={{ width: '75%' }} /></div>
              <span className="l-dim">3 of 4 paid · $307 each</span>
              <div className="x-mini-actions"><span className="x-btn">Pay $307</span></div>
            </div>
          </Step>
          <Step n={4} title="Book" line="The coordinator gets it all at once and books. Every payment is verified on-chain.">
            <div className="x-mini-card">
              <div className="x-booked"><span className="l-seal"><Icon name="seal" /></span><div><b>Booked</b><span className="l-dim">$1,228 paid to John</span></div></div>
              <VerifiedBadge level="verified" compact />
            </div>
          </Step>
        </div>
      </section>

      {/* 4. Pact Pilot: the AI planner, right in the chat. */}
      <section id="pilot" className="x-section">
        <div className="x-grok-head"><span className="m-grok-tile big"><Grok size={34} /></span><div><h2>Meet Pact Pilot, your trip planner in the chat.</h2><p>Type @Pilot and ask. It searches, puts the options to a vote, and keeps track of who still needs to approve or pay. It can never move your money.</p></div></div>
        <div className="l-card x-pilot-demo">
          <div className="x-msg me"><span>@Pilot find a place in Austin under $300 each</span></div>
          <div className="x-pilot-reply">
            <span className="m-grok-tile"><Grok size={16} /></span>
            <div>
              <b>Pact Pilot</b>
              <span className="l-dim">Three places that fit your dates and budget. Tap one to vote.</span>
              <div className="x-votes">
                <div className="x-vote on"><b>South Congress house</b><span>$142 each</span><i><Faces who={['maya', 'jordan']} size={18} />2 votes</i></div>
                <div className="x-vote"><b>Hotel Indigo</b><span>$195 each</span><i>1 vote</i></div>
                <div className="x-vote"><b>Firehouse Hostel</b><span>$88 each</span><i>0 votes</i></div>
              </div>
            </div>
          </div>
          <div className="x-pilot-wait"><span className="m-grok-tile"><Grok size={13} /></span><span>Waiting on <b>Sam</b> to approve the plan.</span><Face who="sam" size={22} /></div>
        </div>
        <a className="x-to-bot" href="#grokbot"><img src="/grok-bot.png" alt="" />Use Pact Pilot from the Grok Bot app →</a>
      </section>

      {/* Grok Bot: plan your pacts from the Grok Bot app, set up in six steps. */}
      <section id="grokbot" className="x-section x-grokbot">
        <div className="x-grok-head">
          <img className="x-bot-logo" src="/grok-bot.png" alt="" />
          <div>
            <h2>Plan from Grok Bot</h2>
            <p>Connect Pact to the Grok Bot app in six steps. You sign in with Google: no keys, no code. It can never move your money.</p>
          </div>
          <a className="x-btn x-bot-get" href={GROK_BOT_URL} target="_blank" rel="noreferrer">Get Grok Bot</a>
        </div>
        <div className="x-grokbot-guide">
          <GrokBotGuide />
        </div>
        <ToolGrid />
      </section>

      {/* 5. Why the money is safe. */}
      <section id="trust" className="x-section">
        <h2>Money you can trust</h2>
        <div className="x-trust">
          <div className="x-trust-card"><BankCard info={{ balance: '1,228.00', address: '0x7a3fC2e91B0d44A58e6F1c93D27b8E05aF41c6D2', name: 'John Smith' }} /></div>
          <div className="x-trust-points">
            <div><Icon name="checkCircle" size={20} /><span><b>Held until everyone pays.</b> Shares sit in the pact, not in one person’s account, until the whole group is in.</span></div>
            <div><Icon name="seal" size={20} /><span><b>Pact Verified.</b> Every payment is checked on-chain by QuickNode, so nobody has to take anyone’s word for it.</span></div>
            <div><Icon name="wallet" size={20} /><span><b>Only you can pay.</b> Your wallet is yours, protected by your own PIN. Pact Pilot can plan, but it can never move money.</span></div>
          </div>
        </div>
      </section>

      {/* 6. The tab, for everything after the booking. */}
      <section className="x-section">
        <h2>Everything after the booking, too.</h2>
        <p className="x-sub">Coffee, Ubers, the extra night: log it on the tab and it splits to the cent. Settle up in one tap.</p>
        <div className="l-card x-tab-demo">
          <div className="x-tab-row"><Icon name="dinner" size={16} /><b>Coffee for everyone</b><span className="l-dim">John paid · split 4 ways</span><span>$18.00</span></div>
          <div className="x-tab-row"><Icon name="other" size={16} /><b>Uber to Zilker Park</b><span className="l-dim">Maya paid · split 3 ways</span><span>$24.60</span></div>
          <div className="x-tab-row"><Icon name="stay" size={16} /><b>Extra night (extras)</b><span className="l-dim">Approved · paying</span><span>$55 each</span></div>
          <div className="x-tab-foot"><span>You’re owed <b className="x-owed">$13.50</b></span><span className="x-btn">Settle up</span></div>
        </div>
      </section>

      {/* 7. The real app. */}
      <section id="app" className="x-section">
        <h2>Every pact on one timeline</h2>
        <div className="x-app">
          <div className="x-browser">
            <div className="x-browser-bar"><i /><i /><i /><span>pact.app/pacts</span></div>
            <div className="x-browser-body">
              <MockDay day="Oct 2" weekday="Friday">
                <MockPact when="Oct 2 – 4" name="Austin ACL weekend" by="you · with Maya, Jordan & Sam" where="South Congress, Austin" chip={['Owe $307', 'warn']} faces={['rory', 'maya', 'jordan', 'sam']} kind="trip" />
              </MockDay>
              <MockDay day="Nov 13" weekday="Friday">
                <MockPact when="Nov 13 – 15" name="Tahoe cabin" by="Maya · with you & Sam" where="South Lake Tahoe" chip={['Booked', 'go']} verified faces={['maya', 'rory', 'sam']} kind="stay" />
              </MockDay>
              <MockDay day="Dec 5" weekday="Saturday" last>
                <MockPact when="Dec 5" name="Dinner at Uchi" by="Jordan · with you" where="Austin" chip={['Planning', 'mute']} faces={['jordan', 'rory']} kind="dinner" />
              </MockDay>
            </div>
          </div>
          <div className="x-phones" aria-label="Pact on iPhone">
            <div className="x-phone real back"><img src="/ios/wallet.jpg" alt="Pact on iPhone: the Wallet tab with the balance card and activity" /></div>
            <div className="x-phone real"><img src="/ios/home.jpg" alt="Pact on iPhone: Home with the wallet card and your pacts" /></div>
          </div>
        </div>
        <p className="x-note">Web and iPhone, on the same live data.</p>
      </section>

      {/* 8. The ask. */}
      <section className="x-cta">
        <h2>Stop fronting the money. Start a pact.</h2>
        <div className="x-hero-actions" style={{ justifyContent: 'center' }}>
          <GoogleButton big />
          {testflight && <a className="x-testflight" href={testflight} target="_blank" rel="noreferrer">Get the iPhone app</a>}
        </div>
        <p className="x-built">Built on Arc with Circle wallets and USDC, verified by QuickNode, planned by Grok.</p>
      </section>

      <footer className="x-foot"><img src="/pact-mark.png" alt="" /><span>Pact · made by the Pact team · UBC Hackathon 2026</span></footer>
    </div>
  )
}

/** The hero: the Pact team's real Texas Trip, drawn with the app's own step card, moving through Plan, Approve,
 *  Pay and Booked on a loop. Easter egg: the faces are the three of us who built Pact; hover one to see who did what. */
const TEAM = [
  { name: 'Rory Geddes', url: '/team/rory.jpg', built: 'Rory · coordinator · built Pact Pilot, Google sign-in, and the Arc + Circle wallets' },
  { name: 'Nihar Ganesh', url: '/team/nihar.png', built: 'Nihar · built the Pact app you are looking at' },
  { name: 'Vamsi Bapatla', url: '/team/vamsi.png', built: 'Vamsi · built the Supabase backend' },
]
const TRIP = { name: 'Texas Trip', place: 'Austin Texas', dates: 'Nov 19 – Nov 22', budget: '$300 each', each: '$233.50', total: '$700.50' }
const STAGES = ['Plan', 'Approve', 'Pay', 'Booked']

function TeamFaces({ size = 32, only }: { size?: number; only?: number[] }) {
  return (
    <div className="l-stack">
      {TEAM.filter((_, i) => !only || only.includes(i)).map((t) => <span key={t.name} title={t.built} className="x-team-face"><Avatar name={t.name} url={t.url} size={size} /></span>)}
    </div>
  )
}

function LoopingPact() {
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (paused || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const t = setInterval(() => setI((n) => (n + 1) % STAGES.length), 5000)
    return () => clearInterval(t)
  }, [paused])
  return (
    <div className="x-real" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="x-real-head">
        <b>{TRIP.name}</b>
        <div className="x-real-chips">
          <span><Icon name="pin" size={13} />{TRIP.place}</span>
          <span><Icon name="calendar" size={13} />{TRIP.dates}</span>
          <span><Icon name="wallet" size={13} />{TRIP.budget}</span>
        </div>
      </div>
      <ol className="l-progress-steps" aria-label="Pact progress">
        {STAGES.map((label, k) => {
          const done = k < i || i === 3
          const now = k === i && i !== 3
          return (
            <li key={label} className={done ? 'done' : now ? 'now' : ''} aria-current={now ? 'step' : undefined}>
              <button type="button" className="x-real-dot" onClick={() => setI(k)} aria-label={label}><span className="dot">{done ? <Icon name="check" /> : k + 1}</span></button>
              <span className="label">{label}</span>
            </li>
          )
        })}
      </ol>
      <div className="x-real-body" key={i}>
        {i === 0 && (
          <div className="l-card l-status">
            <TeamFaces />
            <h3>Keep planning</h3>
            <div className="x-real-items">
              <div><Icon name="stay" size={15} /><b>Hilton Garden Inn Capitol District</b><span>$231</span></div>
              <div><Icon name="other" size={15} /><b>CapMetro Route 20, airport and back</b><span>$2.50</span></div>
              <div className="x-real-total"><b>Each person pays</b><span>{TRIP.each}</span></div>
            </div>
            <div className="l-status-actions"><span className="l-btn"><Icon name="sparkles" size={15} />Send for approval</span></div>
          </div>
        )}
        {i === 1 && (
          <div className="l-card l-status">
            <TeamFaces />
            <h3>Approve the plan</h3>
            <p>Pact Pilot wrote up what the group agreed: the Hilton and the bus, {TRIP.each} each. Everyone approves before anyone pays.</p>
            <div className="x-real-wait"><Grok size={13} /><span>Waiting on <b>Nihar</b> to approve the plan.</span><TeamFaces size={22} only={[1]} /></div>
            <div className="l-status-actions"><span className="l-btn">Approve</span><span className="l-btn l-ghost">Not yet</span></div>
          </div>
        )}
        {i === 2 && (
          <div className="l-card l-status">
            <TeamFaces />
            <h3>Approve your share</h3>
            <p>Pay your share into the pact. It goes to Rory once everyone has paid.</p>
            <div className="l-progress"><i style={{ width: '66.6%' }} /></div>
            <p style={{ fontSize: 13 }}>2 of 3 paid · {TRIP.each} each · you’re in</p>
            <div className="l-status-actions"><span className="l-btn">Approve {TRIP.each}</span></div>
          </div>
        )}
        {i === 3 && (
          <div className="l-card l-booked">
            <div className="l-booked-top">
              <span className="l-seal"><Icon name="seal" /></span>
              <div style={{ flex: 1, minWidth: 0 }}><h3>Booked</h3><p>{TRIP.total} paid to Rory</p></div>
              <VerifiedBadge level="verified" />
            </div>
            <div className="l-checks">
              {TEAM.map((t) => (
                <div key={t.name} className="l-check-row" title={t.built}>
                  <Avatar name={t.name} url={t.url} size={28} />
                  <span style={{ flex: 1 }}>{t.name.split(' ')[0]} paid</span>
                  <span className="ok"><Icon name="shield" />Verified by QuickNode</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <p className="x-real-egg">The real pact the Pact team used for our UBC hackathon trip to Austin. Hover a face to see who built what.</p>
    </div>
  )
}

function Step({ n, title, line, children }: { n: number; title: string; line: string; children: React.ReactNode }) {
  return (
    <div className="l-card x-step">
      <div className="x-step-head"><span className="x-step-n">{n}</span><b>{title}</b></div>
      <div className="x-step-ui">{children}</div>
      <p>{line}</p>
    </div>
  )
}

function MockDay({ day, weekday, last, children }: { day: string; weekday: string; last?: boolean; children: React.ReactNode }) {
  return (
    <section className="l-day x-day" style={last ? { paddingBottom: 0 } : undefined}>
      <div className="l-when"><b>{day}</b><span>{weekday}</span></div>
      <div className="l-rail" />
      <div className="l-events">{children}</div>
    </section>
  )
}

function MockPact({ when, name, by, where, chip, faces, kind, verified }: { when: string; name: string; by: string; where: string; chip: [string, 'go' | 'warn' | 'mute']; faces: Who[]; kind: S.PactKind; verified?: boolean }) {
  return (
    <div className="l-card l-event">
      <div className="l-event-main">
        <div className="l-event-top">{when}</div>
        <h3>{name}</h3>
        <div className="l-meta"><Faces who={faces.slice(0, 3)} size={20} /><span>By {by}</span></div>
        <div className="l-meta"><Icon name="pin" /><span>{where}</span></div>
        <div className="l-event-foot"><span className={`l-chip ${chip[1]}`}>{chip[0]}</span>{verified && <VerifiedBadge level="verified" compact />}<Faces who={faces} size={24} /></div>
      </div>
      <div className="l-cover"><Icon name={kind} /><b>{name}</b></div>
    </div>
  )
}
