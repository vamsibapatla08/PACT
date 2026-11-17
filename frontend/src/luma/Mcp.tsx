import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import * as S from './store'
import { Grok, Icon } from './ui'
import { GoogleButton } from './Landing'
import { LiquidGold } from './LiquidGold'

/** Where Grok (or any MCP client) connects. */
export const MCP_URL = `${(import.meta.env.VITE_SUPABASE_URL ?? 'https://your-project.supabase.co').replace(/\/$/, '')}/functions/v1/pact-mcp`

export type McpTool = { name: string; label: string; does: string; read?: boolean; detail: string; ask: string; result: string[] }

export const mcpTools: McpTool[] = [
  { name: 'list_pacts', label: 'List pacts', does: 'Every pact, its stage and what you owe', read: true,
    detail: 'Grok sees every pact you are in: the dates, the place, how many people, where it is (planning, approving, paying or booked) and what you still owe.',
    ask: 'What trips do I have coming up?',
    result: ['Austin ACL weekend, Oct 2 to 5, 4 people, approving', 'Texas Trip, Austin, planning', 'You owe $0.10 in Austin Rory'] },
  { name: 'get_pact', label: 'Read a pact', does: 'People, itinerary, prices, latest plan', read: true,
    detail: 'One pact in full: who is in it and who coordinates, everything on the itinerary with its price each, the latest plan Grok wrote, and who has paid.',
    ask: "What's the plan for ACL?",
    result: ['People: You (coordinator), Vamsi, Nihar, Dimple', 'Stay: South Congress house, 2 nights, $180 each', 'Tickets: ACL 3-day pass, $150 each', 'Each person pays $330'] },
  { name: 'create_pact', label: 'Create a pact', does: 'Name, place, dates and budget',
    detail: 'Starts a new pact with you as the coordinator, with its name, place, dates and budget per person. You invite friends from the Pact app.',
    ask: 'Start a pact for Miami spring break, March 14 to 18, $500 each.',
    result: ['Created "Miami spring break"', "You're the coordinator", 'Invite friends from the Pact app'] },
  { name: 'add_item', label: 'Add to the itinerary', does: 'A stay, flight, tickets or dinner, priced each',
    detail: 'Adds one thing the group is booking, with its kind, dates, a link and the price per person. Grok searches for real options first and adds the one you pick.',
    ask: 'Add the Airbnb on South Congress, $180 each.',
    result: ['Added stay "South Congress house, 2 nights"', '$180 each', 'Link saved for the group'] },
  { name: 'post_message', label: 'Post in the chat', does: 'A message to the group, as you',
    detail: "Posts in the pact's group chat as you, like a recap of the plan or a nudge to approve. Grok asks you before it posts.",
    ask: 'Tell the group the plan is ready to approve.',
    result: ['Posted to the ACL chat:', '"Plan is up: house + 3-day passes, $330 each. Approve in Pact when you can."'] },
  { name: 'propose_booking', label: 'Put it up for approval', does: 'Everyone approves before anyone pays',
    detail: 'Puts the whole itinerary up for a vote at its total per person. Nobody pays until everyone approves, and then each person pays their own share with their PIN.',
    ask: "Looks good, put it up for approval.",
    result: ['"Book Austin ACL weekend?" is open', '$330 each, everyone has to approve', 'Nobody pays until they all do'] },
  { name: 'payment_status', label: "Who's paid", does: 'Each share, paid or owed on Arc', read: true,
    detail: "Each person's share and whether it's paid, straight from the payments on Arc. Grok can see it but can never pay or move money.",
    ask: "Who still hasn't paid for ACL?",
    result: ['Split: $330 each, open', 'You: paid · Vamsi: paid', 'Nihar: owed · Dimple: owed'] },
]

/** The link for Grok's connector dialog, which only takes a URL: the token rides along as ?key=. */
export const connectorUrl = (token = 'pact_…') => `${MCP_URL}?key=${token}`

/** Instructions for a Grok bot that plans in Pact. Paste into a Grok project. */
export const GROK_PROMPT = `You are Pact Planner, a travel planner for group trips in Pact.
Pact's rule: collect money before you book.

You have the Pact connector:
- list_pacts, get_pact: read pacts, people, itinerary, stage
- create_pact: start a pact (name, place, dates, budget each)
- add_item: add a stay, flight, tickets, dinner or other, priced per person
- post_message: post in the pact's group chat
- propose_booking: put the itinerary up for everyone to approve
- payment_status: see who has paid

How to work:
1. Start with list_pacts. If it's unclear which pact, ask. Read it with get_pact before changing anything.
2. To plan, search the web for real options that fit the place, dates, group size and budget each. Show 2-3 with the price per person and a link.
3. When the user picks one, add it with add_item: the right kind, a short title, dates, price_each per person and the link.
4. Keep the total per person within budget. Say so if it isn't.
5. When the itinerary is done and the user says go, call propose_booking, then post a short note in the chat with post_message.
6. You can't pay or move money. Everyone approves and pays their own share with their PIN in the Pact app. Use payment_status to see who's paid.

Ask before create_pact, propose_booking or post_message. Keep replies short.`

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
            <span className="m-bubble-who"><Grok size={14} />Grok · {tool.name}</span>
            {tool.result.map((line) => <span key={line}>{line}</span>)}
          </div>
        </div>
      </div>
    </div>
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
        <h1 className="l-h1" style={{ display: 'flex', gap: 14, alignItems: 'center' }}><span className="m-grok-tile"><Grok size={26} /></span>Grok</h1>
      </div>
      <p className="l-sub" style={{ marginTop: -14, marginBottom: 28 }}>Plan your pacts by chatting with Grok. It can never pay.</p>
      <div className="l-card m-hero">
        {tokens && tokens.length > 0
          ? <span className="m-status on"><Icon name="check" size={16} />Connected to Grok</span>
          : <span className="m-status">Not connected yet. It takes one link and a Google sign-in.</span>}
        <div className="m-hero-actions">
          <Copy text={MCP_URL} label="Copy Pact link" />
          <a className="l-btn" href="https://grok.com/connectors" target="_blank" rel="noreferrer">Open Grok</a>
        </div>
      </div>

      <h2 className="l-h2">1. Add Pact to Grok</h2>
      <div className="l-card m-setup">
        <ol className="m-steps">
          <li><span>1</span>Open <a href="https://grok.com/connectors" target="_blank" rel="noreferrer">grok.com/connectors</a>, then <b>New Connector → Custom</b>.</li>
          <li><span>2</span>Name it <b>Pact</b> and paste this link as the server URL.</li>
          <li><span>3</span>Grok sends you to Pact. <b>Continue with Google</b>, tap <b>Allow</b>, and you're connected.</li>
        </ol>
        <div className="m-token-row"><code>{MCP_URL}</code><Copy text={MCP_URL} label="Copy link" /></div>
      </div>

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

      <h2 className="l-h2">2. Make your Grok bot</h2>
      <div className="l-card m-setup">
        <ol className="m-steps">
          <li><span>1</span>In Grok, start a new <b>Project</b> called <b>Pact Planner</b>.</li>
          <li><span>2</span>Paste this as its instructions, and turn on the Pact connector.</li>
          <li><span>3</span>Ask it: <i>"Plan our Austin weekend under $400 each."</i></li>
        </ol>
        <pre className="m-code m-prompt">{GROK_PROMPT}</pre>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Copy text={GROK_PROMPT} label="Copy prompt" /></div>
      </div>

      <h2 className="l-h2">Using the xAI API instead</h2>
      <div className="l-card m-setup">
        <div className="m-token-row"><span className="l-dim">Server</span><code>{MCP_URL}</code><Copy text={MCP_URL} /></div>
        <pre className="m-code">{grokSnippet()}</pre>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Copy text={grokSnippet()} label="Copy request" /></div>
        <p className="l-faint" style={{ fontSize: 13, margin: 0 }}>Any MCP client works the same way: this URL, with your token as a Bearer header.</p>
      </div>

      <h2 className="l-h2">What Grok can do</h2>
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
