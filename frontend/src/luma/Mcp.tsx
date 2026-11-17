import { useEffect, useState } from 'react'
import * as S from './store'
import { Grok, Icon } from './ui'

/** Where Grok (or any MCP client) connects. */
export const MCP_URL = `${(import.meta.env.VITE_SUPABASE_URL ?? 'https://your-project.supabase.co').replace(/\/$/, '')}/functions/v1/pact-mcp`

export const mcpTools: { name: string; label: string; does: string; read?: boolean }[] = [
  { name: 'list_pacts', label: 'List pacts', does: 'Every pact, its stage and what you owe', read: true },
  { name: 'get_pact', label: 'Read a pact', does: 'People, itinerary, prices, latest plan', read: true },
  { name: 'create_pact', label: 'Create a pact', does: 'Name, place, dates and budget' },
  { name: 'add_item', label: 'Add to itinerary', does: 'A stay, flight, tickets or dinner, priced each' },
  { name: 'post_message', label: 'Post in the chat', does: 'A message to the group, as you' },
  { name: 'propose_booking', label: 'Put it up for approval', does: 'Everyone approves before anyone pays' },
  { name: 'payment_status', label: "Who's paid", does: 'Each share, paid or owed on Arc', read: true },
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

export function ToolGrid() {
  return (
    <div className="m-tools">
      {mcpTools.map((t) => (
        <div key={t.name} className="m-tool">
          <code>{t.name}</code>
          <b>{t.label}</b>
          <span>{t.does}</span>
          {t.read && <i>Read only</i>}
        </div>
      ))}
    </div>
  )
}

type Token = { token_id: string; label: string; token_hint: string; created_at: string; last_used_at: string | null; revoked_at: string | null }

/** Signed in: make a token for Grok, see the setup, revoke old tokens. */
export function ConnectPage() {
  const [tokens, setTokens] = useState<Token[] | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = async () => {
    const { data, error: e } = await S.supabase.from('pact_mcp_tokens').select('token_id, label, token_hint, created_at, last_used_at, revoked_at').is('revoked_at', null).order('created_at', { ascending: false })
    if (e) setError(/pact_mcp_tokens|does not exist|PGRST205/i.test(e.message) ? 'Connect Grok needs the latest database update.' : "Couldn't load your tokens.")
    setTokens((data ?? []) as Token[])
  }
  useEffect(() => { void load() }, [])
  async function make() {
    setBusy(true); setError(null)
    const { data, error: e } = await S.supabase.rpc('create_mcp_token', { p_label: 'Grok' })
    if (e) setError(e.message.includes('10 tokens') ? e.message : "Couldn't make a token.")
    else { setFresh(data as string); await load() }
    setBusy(false)
  }
  async function revoke(id: string) {
    await S.supabase.rpc('revoke_mcp_token', { p_token_id: id })
    await load()
  }
  return (
    <main className="l-page">
      <div className="l-head">
        <h1 className="l-h1" style={{ display: 'flex', gap: 14, alignItems: 'center' }}><span className="m-grok-tile"><Grok size={26} /></span>Connect Grok</h1>
      </div>
      <p className="l-sub" style={{ marginTop: -14 }}>Grok plans your pacts for you. It can never pay.</p>

      <h2 className="l-h2">1. Make a token</h2>
      <div className="l-card m-token">
        {fresh ? (
          <>
            <span className="l-dim" style={{ fontSize: 14 }}>Copy it now. It won't be shown again.</span>
            <div className="m-token-row"><code>{fresh}</code><Copy text={fresh} /></div>
          </>
        ) : (
          <div className="m-token-row"><span className="l-dim">A personal token lets Grok act as you in Pact.</span><button className="l-btn" type="button" disabled={busy} onClick={() => void make()}>{busy ? 'Making…' : 'Make a token'}</button></div>
        )}
        {error && <p className="l-error">{error}</p>}
        {tokens && tokens.length > 0 && (
          <div className="m-token-list">
            {tokens.map((t) => (
              <div key={t.token_id} className="l-row">
                <div className="l-row-main"><b>{t.label} · pact_…{t.token_hint}</b><span>Made {new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{t.last_used_at ? ` · used ${new Date(t.last_used_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ' · not used yet'}</span></div>
                <button className="l-remove" type="button" onClick={() => void revoke(t.token_id)}>Revoke</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <h2 className="l-h2">2. Add Pact to Grok</h2>
      <div className="l-card m-setup">
        <ol className="m-steps">
          <li><span>1</span>Open <a href="https://grok.com/connectors" target="_blank" rel="noreferrer">grok.com/connectors</a>, then <b>New Connector → Custom</b>.</li>
          <li><span>2</span>Name it <b>Pact</b> and paste this link as the server URL.</li>
        </ol>
        <div className="m-token-row"><code>{connectorUrl(fresh ?? 'pact_…')}</code><Copy text={connectorUrl(fresh ?? 'pact_…')} label="Copy link" /></div>
        {!fresh && <p className="l-faint" style={{ fontSize: 13, margin: 0 }}>Make a token above and the link fills in. The link holds your token, so keep it private.</p>}
      </div>

      <h2 className="l-h2">3. Make your Grok bot</h2>
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
        <pre className="m-code">{grokSnippet(fresh ?? 'pact_…')}</pre>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Copy text={grokSnippet(fresh ?? 'pact_…')} label="Copy request" /></div>
        <p className="l-faint" style={{ fontSize: 13, margin: 0 }}>Any MCP client works the same way: this URL, with your token as a Bearer header.</p>
      </div>

      <h2 className="l-h2">What Grok can do</h2>
      <ToolGrid />
    </main>
  )
}
