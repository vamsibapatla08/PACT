import { useState } from 'react'
import * as S from './store'
import { BankCard } from './BankCard'
import { LiquidGold } from './LiquidGold'
import { Copy, GROK_PROMPT, ToolGrid, connectorUrl } from './Mcp'
import { Grok, Icon, VerifiedBadge } from './ui'

// Everything below is the real Pact UI with made-up data. Rory is the coordinator; the friends are fictional.
const people = {
  rory: { name: 'Rory', initial: 'R', tone: '#c9cbd1' },
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

function GoogleButton({ big }: { big?: boolean }) {
  const [busy, setBusy] = useState(false)
  return (
    <button className={big ? 'x-google big' : 'x-google'} type="button" disabled={busy}
      onClick={() => { setBusy(true); void S.supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/` } }) }}>
      <GoogleG size={big ? 20 : 17} />{busy ? 'Opening Google…' : 'Continue with Google'}
    </button>
  )
}

export function Landing() {
  return (
    <div className="l-app x-landing">
      <LiquidGold />
      <header className="x-top">
        <a className="x-brand" href="/"><img src="/pact-mark.png" alt="" /><b>Pact</b></a>
        <nav className="x-links">
          <a href="#how">How it works</a>
          <a href="#app">The app</a>
          <a href="#grok">Grok</a>
        </nav>
        <GoogleButton />
      </header>

      <section className="x-hero">
        <div className="x-hero-copy">
          <span className="x-kicker">Group trips, settled first</span>
          <h1>Collect money before you book.</h1>
          <p>Plan it in one chat. Everyone approves and pays their share. Then you book.</p>
          <GoogleButton big />
        </div>
        <div className="x-hero-card">
          <BankCard info={{ balance: '1,228.00', address: '0x7a3fC2e91B0d44A58e6F1c93D27b8E05aF41c6D2', name: 'Rory Geddes' }} />
          <div className="x-hero-pills"><span className="l-stat ok"><Icon name="checkCircle" size={16} />4 of 4 paid</span><VerifiedBadge level="verified" compact /></div>
        </div>
      </section>

      <section id="how" className="x-section">
        <h2>How it works</h2>
        <div className="x-steps">
          <Step n={1} title="Plan" line="Talk it through. Grok writes up what you agreed.">
            <div className="x-chat">
              <div className="x-msg"><Face who="maya" size={24} /><span>Found a house on South Congress, $142 each?</span></div>
              <div className="x-msg me"><span>In. Add the ACL passes too</span></div>
            </div>
            <div className="x-items">
              <div><Icon name="stay" size={15} /><b>South Congress house</b><span>$142</span></div>
              <div><Icon name="ticket" size={15} /><b>ACL 3-day pass</b><span>$165</span></div>
            </div>
          </Step>
          <Step n={2} title="Approve" line="Everyone signs off before anyone pays.">
            <div className="x-mini-card">
              <Faces who={['rory', 'maya', 'jordan', 'sam']} />
              <b>Book Austin ACL weekend?</b>
              <span className="l-dim">$307 each · 3 of 4 approved</span>
              <div className="x-mini-actions"><span className="x-btn">Approve</span><span className="x-btn ghost">Not yet</span></div>
            </div>
          </Step>
          <Step n={3} title="Pay" line="Each person pays their share with their PIN.">
            <div className="x-mini-card">
              <b>Approve your share</b>
              <div className="l-progress"><i style={{ width: '75%' }} /></div>
              <span className="l-dim">3 of 4 paid · $307 each</span>
              <div className="x-mini-actions"><span className="x-btn">Approve $307</span></div>
            </div>
          </Step>
          <Step n={4} title="Book" line="The coordinator gets it all and books it.">
            <div className="x-mini-card">
              <div className="x-booked"><span className="l-seal"><Icon name="seal" /></span><div><b>Booked</b><span className="l-dim">$1,228 paid to Rory</span></div></div>
              <VerifiedBadge level="verified" compact />
            </div>
          </Step>
        </div>
      </section>

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
        <p className="x-note">Web and iPhone, on the same live data. The phones are real screenshots.</p>
      </section>

      <section id="grok" className="x-section">
        <div className="x-grok-head"><span className="m-grok-tile big"><Grok size={34} /></span><div><h2>Plan with Grok</h2><p>Pact's MCP server lets Grok plan your pacts. It can never pay.</p></div></div>
        <div className="x-grok">
          <div className="x-convo">
            <div className="x-ask"><Face who="rory" size={28} /><span>Plan our ACL weekend under $400 each.</span></div>
            <div className="x-calls">
              {['list_pacts', 'add_item · South Congress house', 'add_item · ACL 3-day pass', 'propose_booking'].map((c) => <code key={c}><Icon name="check" size={13} />{c}</code>)}
            </div>
            <div className="x-answer"><span className="m-grok-tile"><Grok size={18} /></span><span>Added the house ($142) and passes ($165): <b>$307 each</b>, under budget. It's up for approval in Pact.</span></div>
          </div>
          <div className="x-setup">
            <b>Set up in 2 minutes</b>
            <ol>
              <li><span>1</span>Sign in and open <b>Connect Grok</b> to make your link.</li>
              <li><span>2</span>In Grok, add it at <b>Connectors → Custom</b>.</li>
              <li><span>3</span>Start a <b>Pact Planner</b> project with the ready prompt.</li>
            </ol>
            <pre className="m-code small m-prompt" style={{ maxHeight: 190 }}>{GROK_PROMPT}</pre>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <span className="l-faint" style={{ fontSize: 13 }}>The Pact Planner prompt for your Grok bot</span>
              <Copy text={GROK_PROMPT} label="Copy prompt" />
            </div>
            <span className="l-faint" style={{ fontSize: 12.5 }}>Connector: <code>{connectorUrl().replace(/^https:\/\//, '').replace(/\.supabase\.co/, '…')}</code></span>
          </div>
        </div>
        <ToolGrid />
      </section>

      <section className="x-cta">
        <h2>Collect money before you book.</h2>
        <GoogleButton big />
      </section>

      <footer className="x-foot"><img src="/pact-mark.png" alt="" /><span>Pact · made by Rory Geddes · UBC Hackathon 2026</span></footer>
    </div>
  )
}

function Step({ n, title, line, children }: { n: number; title: string; line: string; children: React.ReactNode }) {
  return (
    <div className="l-card x-step">
      <div className="x-step-head"><span className="x-step-n">{n}</span><b>{title}</b></div>
      <p>{line}</p>
      <div className="x-step-ui">{children}</div>
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
