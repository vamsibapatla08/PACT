import { useEffect, useState } from 'react'
import * as S from './store'
import { BankCard } from './BankCard'
import { LiquidGold } from './LiquidGold'
import { GROK_BOT_URL, GrokBotGuide, ToolGrid } from './Mcp'
import { GrokBotDemo } from './GrokBotDemo'
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
          <a href="#vision">Vision</a>
          <a href="#grokbot" className="x-link-bot"><img src="/grok-bot.png" alt="" />Grok Bot</a>
          <a href="#app">The app</a>
        </nav>
        <a href="#grokbot" className="x-bot-tab" aria-label="Grok Bot"><img src="/grok-bot.png" alt="" /></a>
        <GoogleButton />
      </header>

      {/* 1. Hero: what Pact is in five seconds, and the whole flow playing on the right. */}
      <section className="x-hero">
        <div className="x-hero-copy">
          <h1>The Future of Planning Is Autonomous.</h1>
          <p>PACT turns ideas into action. People, decisions and payments in one place, run by AI.</p>
          <div className="x-hero-actions">
            <GoogleButton big />
            {testflight && <a className="x-testflight" href={testflight} target="_blank" rel="noreferrer">Get the iPhone app</a>}
          </div>
        </div>
        <div className="x-hero-card"><LoopingPact /></div>
      </section>

      {/* 2. The problem everyone has lived through. */}
      <section className="x-section x-problem">
        <h2>No more chasing people, tracking decisions, or juggling five different apps.</h2>
        <div className="x-pains">
          <div className="l-card x-pain"><span className="x-quote">“I’ll pay you back”</span></div>
          <div className="l-card x-pain"><span className="x-quote">One person books the Airbnb</span></div>
          <div className="l-card x-pain"><span className="x-quote">The trip dies in the group chat</span></div>
        </div>
        <p className="x-fix">Pact fixes that.</p>
      </section>

      {/* 3. How it works, in four plain steps. */}
      <section id="how" className="x-section">
        <h2>Planning, Reinvented for the AI Era.</h2>
        <div className="x-arc" aria-hidden="true"><span>Ideas</span><i /><span>Plans</span><i /><span>Decisions</span><i /><span>Action</span></div>
        <div className="x-steps">
          <Step n={1} title="Plan" line="Pact Pilot finds options. The group votes.">
            <div className="x-chat">
              <div className="x-msg"><Face who="maya" size={24} /><span>Found a house on South Congress, $142 each?</span></div>
              <div className="x-msg me"><span>In. Add the ACL passes too</span></div>
            </div>
            <div className="x-items">
              <div><Icon name="stay" size={15} /><b>South Congress house</b><span>$142</span></div>
              <div><Icon name="ticket" size={15} /><b>ACL 3-day pass</b><span>$165</span></div>
            </div>
          </Step>
          <Step n={2} title="Approve" line="Everyone signs off.">
            <div className="x-mini-card">
              <Faces who={['rory', 'maya', 'jordan', 'sam']} />
              <b>Austin ACL weekend</b>
              <span className="l-dim">$307 each · 3 of 4 approved</span>
              <div className="x-mini-actions"><span className="x-btn">Approve</span><span className="x-btn ghost">Not yet</span></div>
            </div>
          </Step>
          <Step n={3} title="Pay" line="Shares held until everyone’s in.">
            <div className="x-mini-card">
              <b>Approve your share</b>
              <div className="l-progress"><i style={{ width: '75%' }} /></div>
              <span className="l-dim">3 of 4 paid · $307 each</span>
              <div className="x-mini-actions"><span className="x-btn">Pay $307</span></div>
            </div>
          </Step>
          <Step n={4} title="Book" line="Paid out in one go, verified on-chain.">
            <div className="x-mini-card">
              <div className="x-booked"><span className="l-seal"><Icon name="seal" /></span><div><b>Booked</b><span className="l-dim">$1,228 paid to John</span></div></div>
              <VerifiedBadge level="verified" compact />
            </div>
          </Step>
        </div>
      </section>

      {/* 4. Pact Pilot: the AI planner, right in the chat. */}
      <section id="pilot" className="x-section">
        <div className="x-grok-head"><span className="m-grok-tile big"><Grok size={34} /></span><div><h2>Meet Pact Pilot, your trip planner next to the chat.</h2><p>Ask by text or voice. It plans, never pays.</p></div></div>
        <div className="x-voice">
          <span className="x-voice-wave" aria-hidden="true">{Array.from({ length: 14 }, (_, k) => <i key={k} style={{ animationDelay: `${(k % 7) * 0.11}s` }} />)}</span>
          <div><b>Talk to it. It talks back.</b><span>Ask out loud. Hear the answer.</span></div>
          <Brand name="ElevenLabs" />
        </div>
        <div className="l-card x-pilot-demo">
          <div className="x-pilot-switch"><span>Pact Chat</span><span className="on"><Grok size={12} />Pact Pilot</span></div>
          <div className="x-msg me"><span>Sum up the chat</span></div>
          <div className="x-pilot-reply">
            <span className="m-grok-tile"><Grok size={16} /></span>
            <div>
              <b>Pact Pilot</b>
              <div className="l-pilot-stats">
                <div><span>Where</span><b>Austin</b></div>
                <div><span>When</span><b>Oct 2 – 4</b></div>
                <div><span>Budget</span><b>$350 each</b></div>
                <div><span>Going</span><b>4 people</b></div>
              </div>
              <div className="l-reply">
                <p>The group picked the <b className="l-metric">South Congress house</b> and ACL passes, <b className="l-metric">$307 each</b>.</p>
                <p>Everyone approved the plan, and <b className="l-metric">3 of 4</b> have paid.</p>
              </div>
            </div>
          </div>
          <div className="l-pilot-next">
            <span className="l-pilot-next-title">Next up</span>
            <div className="l-pilot-next-row"><span>Sam needs to pay $307</span><span className="l-btn l-small">Nudge Sam</span></div>
          </div>
        </div>
        <a className="x-to-bot" href="#grokbot"><img src="/grok-bot.png" alt="" />Use Pact Pilot from the Grok Bot app →</a>
      </section>

      {/* Grok Bot: plan your pacts from the Grok Bot app, set up in six steps. */}
      <section id="grokbot" className="x-section x-grokbot">
        <div className="x-grok-head">
          <img className="x-bot-logo" src="/grok-bot.png" alt="" />
          <div>
            <h2>Plan from Grok Bot</h2>
            <p>Everything Pact does, done for you by an agent. Plan a trip in minutes.</p>
          </div>
          <a className="x-btn x-bot-get" href={GROK_BOT_URL} target="_blank" rel="noreferrer">Get Grok Bot</a>
        </div>
        <GrokBotDemo />
        <div className="x-grokbot-guide">
          <GrokBotGuide />
        </div>
        <ToolGrid />
      </section>

      {/* 5. Why the money is safe. */}
      <section id="trust" className="x-section">
        <h2>Everyone in. Every dollar accounted for.</h2>
        <div className="x-trust">
          <div className="x-trust-card"><BankCard info={{ balance: '1,228.00', address: '0x7a3fC2e91B0d44A58e6F1c93D27b8E05aF41c6D2', name: 'John Smith' }} /></div>
          <div className="x-trust-points">
            <div><Icon name="checkCircle" size={20} /><span><b>Held until everyone pays.</b> Shares wait in escrow on Arc. Trip off? Everyone gets theirs back.</span></div>
            <div><Icon name="seal" size={20} /><span><b>Pact Verified.</b> QuickNode checks every payment on-chain.</span></div>
            <div><Icon name="wallet" size={20} /><span><b>Only you can pay.</b> Your wallet, your PIN. The AI plans, never pays.</span></div>
          </div>
        </div>
      </section>

      {/* 6. The tab, for everything after the booking. */}
      <section className="x-section">
        <h2>Everything after the booking, too.</h2>
        <div className="l-card x-tab-demo">
          <div className="x-tab-row"><Icon name="dinner" size={16} /><b>Coffee for everyone</b><span className="l-dim">John paid · split 4 ways</span><span>$18.00</span></div>
          <div className="x-tab-row"><Icon name="other" size={16} /><b>Uber to Zilker Park</b><span className="l-dim">Maya paid · split 3 ways</span><span>$24.60</span></div>
          <div className="x-tab-row"><Icon name="stay" size={16} /><b>Extra night (extras)</b><span className="l-dim">Approved · paying</span><span>$55 each</span></div>
          <div className="x-tab-foot"><span>You’re owed <b className="x-owed">$13.50</b></span><span className="x-btn">Settle up</span></div>
        </div>
      </section>

      {/* 7. The real app. */}
      {/* How the money moves: wallet, escrow on Arc, QuickNode checks, release. */}
      <section id="flow" className="x-section x-flow">
        <h2>How the money moves</h2>
        <p className="x-flow-lead">Real USDC on Arc. Nobody holds it, not even us.</p>
        <div className="x-stack" aria-label="Built on">
          <span className="x-stack-label">Built on</span>
          {STACK.map((b) => <Brand key={b.name} name={b.name} />)}
        </div>
        <div className="x-flow-track">
          <span className="x-flow-coin" aria-hidden="true">$</span>
          {FLOW.map((f, k) => (
            <div key={f.title} className="x-flow-step">
              <span className="x-flow-n">{k + 1}</span>
              <span className="x-flow-icon"><Icon name={f.icon} size={26} /></span>
              <b>{f.title}</b>
              <span className="x-flow-text">{f.text}</span>
              <Brand name={f.tag} />
            </div>
          ))}
        </div>
        <div className="x-flow-foot">
          <div><Icon name="back" size={18} /><span><b>Trip called off?</b> Everyone claims their share back.</span></div>
          <div><Icon name="sparkles" size={18} /><span><b>Pact Pilot plans with Grok.</b> It reads, never pays.</span></div>
        </div>
        <UnderTheHood />
      </section>

      {/* The vision: once a live on-ramp is in, the agent spends the escrow the group approved. */}
      <section id="vision" className="x-section x-vision">
        <h2>From planning the trip to paying for it. Autonomously.</h2>
        <div className="x-vision-track">
          {VISION.map((v, k) => (
            <div key={v.title} className={v.live ? 'x-vision-step live' : 'x-vision-step'}>
              <span className="x-vision-state">{v.live ? 'Live now' : 'Next'}</span>
              <span className="x-flow-icon"><Icon name={v.icon} size={24} /></span>
              <b>{k + 1}. {v.title}</b>
              <span className="x-flow-text">{v.text}</span>
              <code>{v.backend}</code>
            </div>
          ))}
        </div>
        <div className="x-guard">
          <b>The guardrails the agent can't get around</b>
          <ul>
            <li><Icon name="checkCircle" size={16} />Only approved items, up to the approved total.</li>
            <li><Icon name="shield" size={16} />Rules enforced by the contract on Arc.</li>
            <li><Icon name="seal" size={16} />Every payout verified by QuickNode.</li>
            <li><Icon name="back" size={16} />Unspent money goes back to each person.</li>
          </ul>
        </div>
      </section>

      <section id="app" className="x-section">
        <h2>Every pact on one timeline</h2>
        <div className="x-app">
          <div className="x-browser">
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
      </section>

      {/* 8. The ask. */}
      <section className="x-cta">
        <h2>The next generation of planning starts here.</h2>
        <div className="x-hero-actions" style={{ justifyContent: 'center' }}>
          <GoogleButton big />
          {testflight && <a className="x-testflight" href={testflight} target="_blank" rel="noreferrer">Get the iPhone app</a>}
        </div>
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
const TRIP = { name: 'Texas Trip', place: 'Austin Texas', dates: 'Nov 19 – Nov 22', budget: '$300 each', each: '$231', total: '$693' }
const STAGES = ['Plan', 'Approve', 'Pay', 'Booked']
const FLOW = [
  { icon: 'wallet', title: 'Your wallet', text: 'Made at sign-in. Only your PIN spends.', tag: 'Circle' },
  { icon: 'up', title: 'Pay your share', text: 'Your share, in digital dollars.', tag: 'USDC' },
  { icon: 'shield', title: 'Held in the pact', text: 'Held in escrow until everyone pays.', tag: 'Arc' },
  { icon: 'seal', title: 'Checked on-chain', text: 'Every payment confirmed on-chain.', tag: 'QuickNode' },
  { icon: 'checkCircle', title: 'Released to book', text: 'All in? The total goes out to book.', tag: 'Arc' },
]

const VISION = [
  { icon: 'wallet', title: 'Fund it', text: 'Card or bank to USDC via a live on-ramp.', backend: 'on-ramp → USDC → your Circle wallet', live: false },
  { icon: 'shield', title: 'Hold it', text: 'Shares wait in escrow on Arc.', backend: 'PactSplit.payShare() on Arc', live: true },
  { icon: 'seal', title: 'Verify it', text: 'QuickNode confirms every event.', backend: 'QuickNode Stream → signed webhook', live: true },
  { icon: 'sparkles', title: 'Spend it', text: 'Pact Pilot pays bookings from escrow.', backend: 'agent payout → merchant, capped by contract', live: false },
]

/** A live-looking log of what the backend does when someone pays their share, so people can see the parts. */
const HOOD = [
  { who: 'Circle', line: 'Maya signs with her PIN · 231.00 USDC leaves her wallet' },
  { who: 'Arc', line: 'PactSplit.payShare(texas-trip) · tx confirmed in under a second' },
  { who: 'QuickNode', line: 'Stream picks up SharePaid(pact, maya, 231.00)' },
  { who: 'Supabase', line: 'quicknode-webhook checks the signature · share marked paid' },
  { who: 'Pact', line: 'Pact Verified ✓ · 2 of 3 paid · Pact Pilot posts in the chat' },
  { who: 'Arc', line: 'Last share in → release() · 693.00 USDC to the coordinator' },
]
function UnderTheHood() {
  const [n, setN] = useState(1)
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setN(HOOD.length); return }
    const t = setInterval(() => setN((k) => (k >= HOOD.length + 2 ? 1 : k + 1)), 1300)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="x-hood">
      <div className="x-hood-head">
        <span className="x-hood-dots" aria-hidden="true"><i /><i /><i /></span>
        <b>Under the hood · one share being paid</b>
        <span className="x-hood-qn"><img src="/logos/quicknode.svg" alt="QuickNode" /></span>
      </div>
      <ol className="x-hood-log" aria-live="off">
        {HOOD.map((h, k) => (
          <li key={k} className={k < n ? 'on' : ''}>
            <span className={`x-hood-who ${h.who.toLowerCase()}`}>{h.who}</span>
            <span>{h.line}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** The tools Pact is built on, shown with their own logos. */
const BRANDS: Record<string, { src: string; wide?: boolean }> = {
  QuickNode: { src: '/logos/quicknode.svg', wide: true },
  Arc: { src: '/logos/arc.svg', wide: true },
  Circle: { src: '/logos/circle.svg' },
  USDC: { src: '/logos/usdc.svg' },
  Supabase: { src: '/logos/supabase.svg' },
  Grok: { src: '/logos/grok.svg' },
  ElevenLabs: { src: '/logos/elevenlabs.svg' },
}
const STACK = ['QuickNode', 'Arc', 'Circle', 'USDC', 'Supabase', 'Grok', 'ElevenLabs'].map((name) => ({ name }))
function Brand({ name }: { name: string }) {
  const b = BRANDS[name]
  if (!b) return <span className="x-flow-tag">{name}</span>
  return <span className={b.wide ? 'x-brand-logo wide' : 'x-brand-logo'} title={name}><img src={b.src} alt={name} />{!b.wide && <span>{name}</span>}</span>
}

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
              <div className="x-real-total"><b>Each person pays</b><span>{TRIP.each}</span></div>
            </div>
            <div className="l-status-actions"><span className="l-btn"><Icon name="sparkles" size={15} />Send for approval</span></div>
          </div>
        )}
        {i === 1 && (
          <div className="l-card l-status">
            <TeamFaces />
            <h3>Approve the plan</h3>
            <p>Everyone approves before anyone pays.</p>
            <div className="x-real-wait"><Grok size={13} /><span>Waiting on <b>Nihar</b> to approve the plan.</span><TeamFaces size={22} only={[1]} /></div>
            <div className="l-status-actions"><span className="l-btn">Approve</span><span className="l-btn l-ghost">Not yet</span></div>
          </div>
        )}
        {i === 2 && (
          <div className="l-card l-status">
            <TeamFaces />
            <h3>Collecting</h3>
            <p>Held until everyone pays.</p>
            <div className="l-progress"><i style={{ width: '33.3%' }} /></div>
            <p style={{ fontSize: 13 }}>1 of 3 paid · {TRIP.each} each</p>
            <div className="x-real-owes">
              {TEAM.map((t, k) => (
                <div key={t.name} title={t.built}>
                  <Avatar name={t.name} url={t.url} size={22} />
                  <span>{t.name.split(' ')[0]}</span>
                  {k === 0 ? <b className="l-net owed">$0.00</b> : <b className="l-net owe">−{TRIP.each}.00</b>}
                </div>
              ))}
            </div>
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
      <p className="x-real-egg">Our real hackathon trip. Hover a face to see who built what.</p>
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
