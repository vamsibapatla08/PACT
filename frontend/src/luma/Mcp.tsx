import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import * as S from './store'
import { Grok, Icon } from './ui'
import { GoogleButton } from './Landing'
import { LiquidGold } from './LiquidGold'

/** Where Grok (or any MCP client) connects. */
// The connector lives on the Pact site, which forwards to the pact-mcp function, so its sign-in details sit at the
// root of our own domain where Grok looks for them.
/** Where to download the Grok Bot app (by SpaceXAI and Cursor). VITE_GROK_BOT_URL overrides it. */
export const GROK_BOT_URL = (import.meta.env.VITE_GROK_BOT_URL as string | undefined) || 'https://cursor.com/download/bot'

export const MCP_URL = (import.meta.env.VITE_PACT_MCP_URL ?? 'https://getpact.space/mcp').replace(/\/$/, '')

export type McpTool = { name: string; label: string; does: string; read?: boolean; detail: string; ask: string; result: string[] }

export const mcpTools: McpTool[] = [
  { name: 'list_pacts', label: 'List pacts', does: 'Every pact, its stage and what you owe', read: true,
    detail: 'Grok Bot sees every pact you are in: the dates, the place, how many people, where it is (planning, approving, paying or booked) and what you still owe.',
    ask: 'What trips do I have coming up?',
    result: ['Texas Trip, Austin, Nov 19 to 22, 3 people, 1 of 3 paid', 'Austin ACL weekend, Oct 2 to 4, 4 people, approving', 'You owe nothing: you paid your $231'] },
  { name: 'get_pact', label: 'Read a pact', does: 'People, itinerary, prices, latest plan', read: true,
    detail: 'One pact in full: who is in it and who coordinates, everything on the itinerary with its price each, the latest plan Pact Pilot wrote, and who has paid.',
    ask: "What's the plan for ACL?",
    result: ['People: You (coordinator), Vamsi, Nihar, Dimple', 'Stay: South Congress house, 2 nights, $180 each', 'Tickets: ACL 3-day pass, $150 each', 'Each person pays $330'] },
  { name: 'create_pact', label: 'Create a pact', does: 'Name, place, dates and budget',
    detail: 'Starts a new pact with you as the coordinator, with its name, place, dates and budget per person. You invite friends from the Pact app.',
    ask: 'Start a pact for Miami spring break, March 14 to 18, $500 each.',
    result: ['Created "Miami spring break"', "You're the coordinator", 'Invite friends from the Pact app'] },
  { name: 'add_item', label: 'Add to the itinerary', does: 'A stay, flight, tickets or dinner, priced each',
    detail: 'Adds one thing the group is booking, with its kind, dates, a link and the price per person. Grok Bot searches for real options first and adds the one you pick.',
    ask: 'Add the Airbnb on South Congress, $180 each.',
    result: ['Added stay "South Congress house, 2 nights"', '$180 each', 'Link saved for the group'] },
  { name: 'start_vote', label: 'Put options to a vote', does: 'Hotels, flights or dinners as vote cards',
    detail: 'Grok Bot puts 2 to 8 real options in the pact chat as cards, each with its price per person and link. Everyone taps the one they want and sees the votes come in live. You can change your vote any time.',
    ask: 'Find us a hotel in Austin under $300 each and let everyone vote.',
    result: ['Started "Austin stay, Nov 19 to 22"', '4 options, from $195 to $253 each', 'Everyone votes on the cards in the chat'] },
  { name: 'post_message', label: 'Post in the chat', does: 'A message to the group, as you',
    detail: "Posts in the pact's group chat as you, like a recap of the plan or a nudge to approve. Grok Bot asks you before it posts.",
    ask: 'Tell the group the plan is ready to approve.',
    result: ['Posted to the ACL chat:', '"Plan is up: house + 3-day passes, $330 each. Approve in Pact when you can."'] },
  { name: 'propose_booking', label: 'Put it up for approval', does: 'Everyone approves before anyone pays',
    detail: 'Puts the whole itinerary up for a vote at its total per person. Nobody pays until everyone approves, and then each person pays their own share with their PIN.',
    ask: "Looks good, put it up for approval.",
    result: ['"Book Austin ACL weekend?" is open', '$330 each, everyone has to approve', 'Nobody pays until they all do'] },
  { name: 'payment_status', label: "Who's paid", does: 'Each share, paid or owed on Arc', read: true,
    detail: "Each person's share and whether it's paid, straight from the payments on Arc. Grok Bot can see it but can never pay or move money.",
    ask: "Who still hasn't paid for ACL?",
    result: ['Split: $330 each, open', 'You: paid · Vamsi: paid', 'Nihar: owed · Dimple: owed'] },
  { name: 'whats_waiting', label: "What's waiting", does: 'Who each pact is waiting on, and if it is you', read: true,
    detail: 'Grok Bot checks every pact for who still has to approve the plan, who still has to pay, or whether the coordinator has to set up the split or release the money. It tells you when it is waiting on you.',
    ask: "What's waiting on me?",
    result: ['Texas Trip: waiting on Nihar and Vamsi to pay $231', 'Austin ACL weekend: waiting on you to approve', 'Waiting on you: Austin ACL weekend'] },
  { name: 'approve_plan', label: 'Approve the plan', does: 'Approves for you, after asking. No money moves',
    detail: "Grok Bot approves the plan that's up for a vote, as you, once you say yes. Approving moves no money: paying your share is its own step with your PIN in the Pact app.",
    ask: 'Approve the ACL plan for me.',
    result: ['Approved Austin ACL weekend', 'Now waiting on Sam to approve', 'No money moved'] },
  { name: 'remind', label: 'Remind the group', does: 'A nudge in the chat, naming who it is waiting on',
    detail: "Grok Bot posts a short reminder in the pact's chat, as you, naming who it's waiting on and what for. It asks you first.",
    ask: 'Nudge Nihar and Vamsi to pay.',
    result: ['Posted in Texas Trip:', '"Reminder: waiting on Nihar and Vamsi to pay their $231 share."'] },
]

/** The link for Grok's connector dialog, which only takes a URL: the token rides along as ?key=. */
export const connectorUrl = (token = 'pact_…') => `${MCP_URL}?key=${token}`

/** The whole setup in one paste: Grok connects Pact (Sign in with Google), then plans. */
export const GROK_PROMPT = `Your name is Pact Pilot. Connect the Pact Pilot connector, then help me plan.

Connector
- Name: Pact Pilot
- URL: ${MCP_URL}
- Sign-in: OAuth. Show me the Connect / Sign in button. I'll sign in with Google and tap Allow, then come back here.
- Don't ask me for a token or an API key.

You are Pact Pilot, a travel planner for group trips in Pact. Pact's rule: collect money before you book.

Tools on the Pact connector
- list_pacts, get_pact: read my pacts, people, itinerary and stage
- create_pact: start a pact (name, place, dates, budget each)
- add_item: add a stay, flight, tickets, dinner or other, priced per person
- start_vote: put 2-8 options (hotels, flights, dinners) to the group as vote cards
- post_message: post a short note in a pact's group chat
- propose_booking: put the itinerary up for everyone to approve
- payment_status: see who has paid
- whats_waiting: who each pact is waiting on (to approve, pay, set up or release), and whether it's me
- approve_plan: approve a plan for me (no money moves)
- remind: post a nudge in a pact's chat naming who it's waiting on

How to work
1. Once I'm connected, start with list_pacts. If it's unclear which pact, ask. Read it with get_pact before changing anything.
2. To plan, search the web for real options that fit the place, dates, group size and budget each. Show them to me with the price per person and a link.
3. When I say to share them, call start_vote with each option's name, price_each, link and one short note. Never paste a list of options with post_message: start_vote shows them as cards everyone can vote on.
4. In a pact with other people, never add something straight to the plan: put it to a vote with start_vote (with real alternatives) so it shows in Findings, and the coordinator adds the winner. Only use add_item directly in a solo pact, or when I say to skip the vote.
5. Keep the total per person within budget. Say so if it isn't.
6. When the itinerary is done and I say go, call propose_booking, then post a short note in the chat with post_message.
7. When I ask what's going on, or come back after a while, call whats_waiting. If a pact is waiting on me, tell me what to do: approve (you can do it with approve_plan once I say yes), or pay or release in the Pact app with my PIN.
8. You can't pay or move money. Everyone approves and pays their own share with their PIN in the Pact app.

Ask before create_pact, start_vote, propose_booking, post_message, approve_plan or remind. Keep replies short.`

export function grokSnippet(token = 'pact_…') {
  return `curl https://api.x.ai/v1/responses \\
  -H "Authorization: Bearer $XAI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
  "model": "grok-4.7",
  "input": "Plan our ACL weekend under $400 each",
  "tools": [{
    "type": "mcp",
    "server_label": "pact",
    "server_url": "${MCP_URL}",
    "authorization": "${token}"
  }]
}'`
}

export function Copy({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button className="l-btn l-ghost l-small" type="button" onClick={() => { void navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) }}>
      <Icon name={done ? 'check' : 'link'} size={14} />{done ? 'Copied' : label}
    </button>
  )
}

/** What Grok can do: the tools down the side, and what the one you pick does, with an example, on the right. */
export function ToolGrid() {
  const [pick, setPick] = useState(mcpTools[0].name)
  const tool = mcpTools.find((t) => t.name === pick) ?? mcpTools[0]
  return (
    <div className="m-explore">
      <nav className="m-explore-list" aria-label="Grok tools">
        {mcpTools.map((t) => (
          <button key={t.name} type="button" className={t.name === pick ? 'on' : ''} onClick={(e) => { setPick(t.name); e.currentTarget.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' }) }} aria-pressed={t.name === pick}>
            <b>{t.label}</b>
            <span>{t.does}</span>
          </button>
        ))}
      </nav>
      <div className="m-explore-preview" aria-live="polite">
        <div className="m-explore-head">
          <h3>{tool.label}</h3>
          <i className={tool.read ? '' : 'acts'}>{tool.read ? 'Read only' : 'Makes a change'}</i>
        </div>
        <code>{tool.name}</code>
        <p>{tool.detail}</p>
        <div className="m-explore-chat">
          <div className="m-bubble me">{tool.ask}</div>
          <div className="m-bubble grok">
            <span className="m-bubble-who"><img src="/grok-bot.png" alt="" width={14} height={14} style={{ borderRadius: 4 }} />Grok Bot · {tool.name}</span>
            {tool.result.map((line) => <span key={line}>{line}</span>)}
          </div>
        </div>
      </div>
    </div>
  )
}

/** How Grok Bot works with Pact, and the six setup steps, as pictures. Used on the Grok Bot tab and the landing page. */
export function GrokBotGuide() {
  return (
    <>
      {/* How it works, as a picture: Grok asks, Pact Pilot plans, you approve in Pact. */}
      <h2 className="l-h2">How Grok Bot works</h2>
      <div className="m-flow">
        <div className="m-flow-node">
          <span className="m-flow-icon dark"><img src="/grok-bot.png" alt="" /></span>
          <b>You ask Grok Bot</b>
          <span>“Plan our Austin trip”</span>
        </div>
        <span className="m-flow-arrow" aria-hidden>→</span>
        <div className="m-flow-node">
          <span className="m-flow-icon"><img src="/pact-mark.png" alt="" /></span>
          <b>Pact plans it</b>
          <span>Reads your pacts, starts votes</span>
        </div>
        <span className="m-flow-arrow" aria-hidden>→</span>
        <div className="m-flow-node">
          <span className="m-flow-icon go"><Icon name="checkCircle" size={24} /></span>
          <b>You approve in Pact</b>
          <span>Pay with your PIN</span>
        </div>
      </div>

      {/* Set up: five small pictures, a few words each. */}
      <h2 className="l-h2">Set it up</h2>
      <div className="m-setup-steps">
        <div className="m-sstep">
          <span className="m-sstep-n">1</span>
          <div className="m-sstep-pic"><img className="m-app-icon" src="/grok-bot.png" alt="" /><small>Grok Bot</small></div>
          <b>Get Grok Bot</b>
          <a className="l-btn l-ghost l-small" href={GROK_BOT_URL} target="_blank" rel="noreferrer">Download</a>
        </div>
        <div className="m-sstep">
          <span className="m-sstep-n">2</span>
          <div className="m-sstep-pic"><div className="m-mini-bot"><span className="m-mini-plus">+</span><span>Pact Pilot</span></div></div>
          <b>Create a bot called “Pact Pilot”</b>
          <span className="m-sstep-hint">It helps plan your pacts</span>
        </div>
        <div className="m-sstep">
          <span className="m-sstep-n">3</span>
          <div className="m-sstep-pic"><div className="m-mini-doc"><i /><i /><i /><i /></div></div>
          <b>Copy the prompt</b>
          <Copy text={GROK_PROMPT} label="Copy" />
        </div>
        <div className="m-sstep">
          <span className="m-sstep-n">4</span>
          <div className="m-sstep-pic"><div className="m-mini-chat"><span className="me">Your name is Pact Pilot…</span><span className="pill">Connect</span></div></div>
          <b>Paste it, tap Connect</b>
        </div>
        <div className="m-sstep">
          <span className="m-sstep-n">5</span>
          <div className="m-sstep-pic"><div className="m-mini-chat"><span className="google">G  Continue with Google</span><span className="pill">Allow</span></div></div>
          <b>Sign in, tap Allow</b>
        </div>
        <div className="m-sstep">
          <span className="m-sstep-n">6</span>
          <div className="m-sstep-pic"><div className="m-mini-chat"><span className="me">What’s waiting on me?</span><span className="them"><img src="/grok-bot.png" alt="" width={11} /> Texas Trip: pay $231</span></div></div>
          <b>Ask anything</b>
        </div>
      </div>
      <details className="m-fold">
        <summary>See the full setup prompt</summary>
        <pre className="m-code m-prompt">{GROK_PROMPT}</pre>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}><Copy text={MCP_URL} label="Copy link only" /><Copy text={GROK_PROMPT} label="Copy setup prompt" /></div>
        <p className="l-faint" style={{ fontSize: 13, margin: 0 }}>No Connect button? In Grok Bot: Connectors → New Connector → Custom, and paste the link only.</p>
      </details>
    </>
  )
}

type Token = { token_id: string; label: string; token_hint: string; created_at: string; last_used_at: string | null; revoked_at: string | null }

/** The Grok tab: connect with one link and Google, see and disconnect connections, set up the bot. */
export function ConnectPage() {
  const [tokens, setTokens] = useState<Token[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = async () => {
    const { data, error: e } = await S.supabase.from('pact_mcp_tokens').select('token_id, label, token_hint, created_at, last_used_at, revoked_at').is('revoked_at', null).order('created_at', { ascending: false })
    if (e) setError(/pact_mcp_tokens|does not exist|PGRST205/i.test(e.message) ? 'Connect Grok needs the latest database update.' : "Couldn't load your tokens.")
    setTokens((data ?? []) as Token[])
  }
  useEffect(() => { void load() }, [])
  async function revoke(id: string) {
    await S.supabase.rpc('revoke_mcp_token', { p_token_id: id })
    await load()
  }
  return (
    <main className="l-page">
      <div className="l-head">
        <h1 className="l-h1" style={{ display: 'flex', gap: 14, alignItems: 'center' }}><img className="m-bot-tile" src="/grok-bot.png" alt="" />Grok Bot</h1>
      </div>
      <p className="l-sub" style={{ marginTop: -14, marginBottom: 24 }}>Plan your pacts from the Grok Bot app. It connects to Pact, and it can never pay.</p>
      <div className="l-card m-hero">
        {tokens && tokens.length > 0
          ? <span className="m-status on"><Icon name="check" size={16} />Connected to Grok Bot</span>
          : <span className="m-status">Not connected to Grok Bot yet</span>}
        <div className="m-hero-actions">
          <Copy text={GROK_PROMPT} label="Copy setup prompt" />
          <a className="l-btn" href={GROK_BOT_URL} target="_blank" rel="noreferrer">Get Grok Bot</a>
        </div>
      </div>

      <GrokBotGuide />


      <h2 className="l-h2">Connections</h2>
      <div className="l-card m-token">
        {tokens && tokens.length > 0 ? (
          <div className="m-token-list">
            {tokens.map((t) => (
              <div key={t.token_id} className="l-row">
                <div className="l-row-main"><b>{t.label} · pact_…{t.token_hint}</b><span>Made {new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{t.last_used_at ? ` · used ${new Date(t.last_used_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ' · not used yet'}</span></div>
                <button className="l-remove" type="button" onClick={() => void revoke(t.token_id)}>Disconnect</button>
              </div>
            ))}
          </div>
        ) : <span className="l-dim">Nothing connected yet.</span>}
        {error && <p className="l-error">{error}</p>}
      </div>

      <details className="m-fold">
        <summary>For developers: the xAI API</summary>
      <div className="l-card m-setup">
        <div className="m-token-row"><span className="l-dim">Server</span><code>{MCP_URL}</code><Copy text={MCP_URL} /></div>
        <pre className="m-code">{grokSnippet()}</pre>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Copy text={grokSnippet()} label="Copy request" /></div>
        <p className="l-faint" style={{ fontSize: 13, margin: 0 }}>Any MCP client works the same way: this URL, and it signs in with Google.</p>
      </div>
      </details>

      <h2 className="l-h2">What Grok Bot can do</h2>
      <ToolGrid />
    </main>
  )
}

// ---- "Continue with Google" from Grok: the MCP server sends people here to sign in and approve.

const PENDING = 'pact-mcp-request'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const remember = (id: string | null) => { try { if (id) sessionStorage.setItem(PENDING, `${id}|${Date.now()}`); else sessionStorage.removeItem(PENDING) } catch { /* private mode */ } }

/** The connect request this page is for: from the link, or saved before Google sign-in in case Google sent us home. */
export function pendingMcpRequest(): string | null {
  const fromLink = location.pathname === '/connect/authorize' ? new URLSearchParams(location.search).get('request') : null
  let saved: string | null = null
  try {
    // Only on the home page, where Google lands if it ignores our return link, and only for 15 minutes.
    const [sid, at] = (sessionStorage.getItem(PENDING) ?? '').split('|')
    if (location.pathname === '/' && Date.now() - Number(at) < 15 * 60_000) saved = sid
  } catch { /* private mode */ }
  const id = fromLink ?? saved
  return id && UUID.test(id) ? id : null
}

type Request = { client_name: string; redirect_uri: string; state: string | null; expired: boolean }

function sendBack(redirect: string, params: Record<string, string | null>) {
  const to = new URL(redirect)
  for (const [k, v] of Object.entries(params)) if (v) to.searchParams.set(k, v)
  remember(null)
  location.assign(to.toString())
}

export function AuthorizeMcp({ session }: { session: Session | null }) {
  const id = pendingMcpRequest()
  const [req, setReq] = useState<Request | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // Google may have sent us back to the home page: put the request back in the address bar.
    if (id && location.pathname !== '/connect/authorize') history.replaceState({}, '', `/connect/authorize?request=${id}`)
    if (!id) { setError('This connect link is missing its request. Start again from Grok.'); return }
    if (!session) return
    void S.supabase.rpc('get_mcp_authorization', { p_request_id: id }).then(({ data, error: e }) => {
      if (e || !data || (data as Request).expired) { remember(null); setError('This connect link has already been used or has expired. Start again from Grok.') }
      else setReq(data as Request)
    })
  }, [id, session])

  async function allow() {
    setBusy(true); setError(null)
    const { data, error: e } = await S.supabase.rpc('approve_mcp_authorization', { p_request_id: id })
    if (e || !data) { setError(e?.message ?? "Couldn't connect. Try again."); setBusy(false); return }
    const out = data as { redirect_uri: string; code: string; state: string | null }
    sendBack(out.redirect_uri, { code: out.code, state: out.state })
  }

  const who = req?.client_name ?? 'Grok'
  return (
    <div className="l-app"><LiquidGold /><div className="l-signin">
      <span className="m-grok-tile"><Grok size={34} /></span>
      <h1>Connect {who} to Pact</h1>
      <p>{who} will plan your pacts as you: read them, add to the plan, post in the chat and put bookings up for approval. It can never pay. Everyone pays their own share with their PIN.</p>
      {error ? <p className="l-error">{error}</p>
        : !session ? <GoogleButton big to={`${location.origin}/connect/authorize?request=${id}`} onStart={() => remember(id)} />
        : !req ? <span className="l-spin" />
        : (
          <>
            <p className="l-faint" style={{ fontSize: 14 }}>Signed in as {session.user.email}</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button className="l-btn l-ghost" type="button" disabled={busy} onClick={() => sendBack(req.redirect_uri, { error: 'access_denied', state: req.state })}>Cancel</button>
              <button className="l-btn" type="button" disabled={busy} onClick={() => void allow()}>{busy ? 'Connecting…' : `Allow ${who}`}</button>
            </div>
            <p className="l-faint" style={{ fontSize: 13 }}>You can disconnect any time on the Connect Grok page.</p>
          </>
        )}
    </div></div>
  )
}
