// Pact's MCP server: Grok (or any MCP client) plans pacts for someone over Streamable HTTP.
// It reads pacts, adds itinerary items, posts to the chat and puts a booking up for approval. It never moves
// money: paying a share always needs the person's own PIN in the Pact app.
//
// Auth: a personal token made in Pact (Connect Grok), sent as "Authorization: Bearer pact_…". The token is
// looked up by its hash, then the server signs in as that person, so every row level security rule and Pact
// function behaves exactly as it does in the app.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const PROTOCOL = '2025-06-18'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KINDS = ['stay', 'flight', 'ticket', 'dinner', 'other']
const PACT_KINDS = ['trip', 'event', 'stay', 'dinner', 'other']

type Json = Record<string, unknown>
type Me = { id: string; name: string; db: SupabaseClient }

// ---- Auth: personal token -> a signed-in client for that person

async function sha256(text: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function signIn(request: Request): Promise<Me | null> {
  const token = request.headers.get('Authorization')?.match(/^Bearer\s+(pact_[0-9a-f]{64})$/i)?.[1]
  if (!token) return null
  const { data: row } = await admin.from('pact_mcp_tokens').select('token_id, user_id').eq('token_hash', await sha256(token)).is('revoked_at', null).maybeSingle()
  if (!row) return null
  const { data: user } = await admin.auth.admin.getUserById(row.user_id)
  const email = user.user?.email
  if (!email) return null
  // A one-time sign-in link, used straight away, gives a normal session for this person.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (linkError || !link.properties?.hashed_token) return null
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: verified } = await anon.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token })
  const access = verified.session?.access_token
  if (!access) return null
  void admin.from('pact_mcp_tokens').update({ last_used_at: new Date().toISOString() }).eq('token_id', row.token_id)
  const db = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${access}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const name = (user.user?.user_metadata?.full_name as string) || (user.user?.user_metadata?.name as string) || email.split('@')[0]
  return { id: row.user_id, name, db }
}

// ---- Tools

const tools = [
  {
    name: 'list_pacts',
    title: 'List my pacts',
    description: "Every pact I'm in, with its dates, place, people, stage (Planning, Approving, Paying, Booked) and what I owe.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_pact',
    title: 'Get a pact',
    description: "One pact in full: overview, people and roles, itinerary items with prices, the latest Grok write-up, the stage, and who has paid.",
    inputSchema: { type: 'object', properties: { pact_id: { type: 'string', description: 'The pact id from list_pacts' } }, required: ['pact_id'], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_pact',
    title: 'Create a pact',
    description: 'Start a new pact with me as coordinator. Friends are invited from the Pact app.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'e.g. "Austin ACL weekend"' },
        kind: { type: 'string', enum: PACT_KINDS },
        about: { type: 'string', description: 'What it is, one line' },
        location: { type: 'string' },
        starts_on: { type: 'string', description: 'YYYY-MM-DD' },
        ends_on: { type: 'string', description: 'YYYY-MM-DD' },
        budget_each: { type: 'number', description: 'Budget per person in USD' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_item',
    title: 'Add to the itinerary',
    description: 'Add one thing the group is booking: a stay, flight, tickets, a dinner or other, with its price per person. Locked once the split is set up.',
    inputSchema: {
      type: 'object',
      properties: {
        pact_id: { type: 'string' },
        kind: { type: 'string', enum: KINDS },
        title: { type: 'string', description: 'e.g. "South Congress house, 2 nights"' },
        price_each: { type: 'number', description: 'USD per person' },
        location: { type: 'string' },
        starts_on: { type: 'string', description: 'YYYY-MM-DD' },
        ends_on: { type: 'string', description: 'YYYY-MM-DD' },
        link: { type: 'string', description: 'Booking link (https)' },
      },
      required: ['pact_id', 'kind', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'post_message',
    title: 'Post in the pact chat',
    description: "Post a message to the pact's group chat as me.",
    inputSchema: { type: 'object', properties: { pact_id: { type: 'string' }, text: { type: 'string' } }, required: ['pact_id', 'text'], additionalProperties: false },
  },
  {
    name: 'propose_booking',
    title: 'Put it up for approval',
    description: "Put the pact's itinerary up for everyone to approve, priced at the items' total per person. Nobody pays until everyone approves, and each person pays with their own PIN in the app.",
    inputSchema: { type: 'object', properties: { pact_id: { type: 'string' } }, required: ['pact_id'], additionalProperties: false },
  },
  {
    name: 'payment_status',
    title: "Who's paid",
    description: "Each person's share for a pact and whether it's paid on Arc. Read only.",
    inputSchema: { type: 'object', properties: { pact_id: { type: 'string' } }, required: ['pact_id'], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
]

class ToolError extends Error {}
const need = (ok: unknown, message: string) => { if (!ok) throw new ToolError(message) }
const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`
const day = (s?: unknown) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null)
const text = (s: unknown, max: number) => (typeof s === 'string' ? s.trim().slice(0, max) : '')

async function stageOf(db: SupabaseClient, pactId: string, me: string) {
  const [{ data: rows }, { data: decisions }] = await Promise.all([
    db.rpc('get_pact_payment_status', { p_pact_id: pactId }),
    db.from('pact_decisions').select('status').eq('pact_id', pactId).order('created_at', { ascending: false }).limit(1),
  ])
  const shares = (rows ?? []) as { payment_status: string; share_usdc: number; user_id: string | null; share_status: string | null }[]
  const plan = shares[0]
  const mine = shares.find((r) => r.user_id === me)
  const owe = plan && mine?.share_status === 'owed' && plan.payment_status === 'open' ? Number(plan.share_usdc) : 0
  if (plan?.payment_status === 'released') return { stage: 'Booked', owe }
  if (plan?.payment_status === 'cancelled') return { stage: 'Cancelled', owe: 0 }
  if (plan) return { stage: 'Paying', owe }
  const d = decisions?.[0]?.status
  if (d === 'open' || d === 'approved') return { stage: 'Approving', owe: 0 }
  return { stage: 'Planning', owe: 0 }
}

async function memberOf(db: SupabaseClient, pactId: string) {
  need(UUID.test(pactId), 'pact_id must be a pact id from list_pacts.')
  const { data } = await db.from('pacts').select('*').eq('pact_id', pactId).maybeSingle()
  need(data, "That pact doesn't exist or you're not in it.")
  return data as Json & { name: string }
}

async function call(name: string, args: Json, me: Me): Promise<{ text: string; data?: unknown }> {
  const db = me.db
  switch (name) {
    case 'list_pacts': {
      const { data: rows } = await db.from('pact_members').select('pact_id').eq('user_id', me.id).eq('membership_status', 'active')
      const ids = [...new Set((rows ?? []).map((r) => r.pact_id as string))]
      if (!ids.length) return { text: "You're not in any pacts yet. Use create_pact to start one.", data: [] }
      const { data: pacts } = await db.from('pacts').select('pact_id, name, pact_type, location, starts_on, ends_on, budget').in('pact_id', ids)
      const out = await Promise.all((pacts ?? []).map(async (p) => {
        const [{ data: members }, s] = await Promise.all([db.rpc('list_pact_members', { p_pact_id: p.pact_id }), stageOf(db, p.pact_id, me.id)])
        return { ...p, people: (members ?? []).length, ...s }
      }))
      out.sort((a, b) => String(a.starts_on ?? '9999').localeCompare(String(b.starts_on ?? '9999')))
      return {
        text: out.map((p) => `• ${p.name} (${p.pact_id}) — ${p.stage}${p.starts_on ? `, ${p.starts_on}${p.ends_on && p.ends_on !== p.starts_on ? ` to ${p.ends_on}` : ''}` : ''}${p.location ? `, ${p.location}` : ''}, ${p.people} ${p.people === 1 ? 'person' : 'people'}${p.owe ? `, you owe ${money(p.owe)}` : ''}`).join('\n'),
        data: out,
      }
    }
    case 'get_pact': {
      const id = text(args.pact_id, 40)
      const pact = await memberOf(db, id)
      const [{ data: members }, { data: items }, { data: recs }, s] = await Promise.all([
        db.rpc('list_pact_members', { p_pact_id: id }),
        db.from('pact_items').select('kind, title, location, starts_on, ends_on, price_each, link').eq('pact_id', id).order('starts_on', { ascending: true, nullsFirst: false }),
        db.from('pact_recommendations').select('summary, created_at').eq('pact_id', id).order('created_at', { ascending: false }).limit(1),
        stageOf(db, id, me.id),
      ])
      const list = (items ?? []) as { kind: string; title: string; price_each: number | null; starts_on: string | null; ends_on: string | null; location: string | null; link: string | null }[]
      const total = list.reduce((n, i) => n + (i.price_each == null ? 0 : Number(i.price_each)), 0)
      const lines = [
        `${pact.name} — ${s.stage}`,
        [pact.pact_type, pact.location, pact.starts_on && `${pact.starts_on}${pact.ends_on ? ` to ${pact.ends_on}` : ''}`, pact.budget != null && `budget ${money(Number(pact.budget))} each`].filter(Boolean).join(' · '),
        pact.description ? `About: ${pact.description}` : '',
        `People: ${((members ?? []) as { user_id: string; name: string | null; role: string }[]).map((m) => `${m.user_id === me.id ? 'You' : m.name ?? 'Someone'}${m.role === 'host' ? ' (coordinator)' : ''}`).join(', ')}`,
        list.length ? `Itinerary:\n${list.map((i) => `  – ${i.kind}: ${i.title}${i.starts_on ? ` (${i.starts_on})` : ''}${i.price_each != null ? ` — ${money(Number(i.price_each))} each` : ''}`).join('\n')}\n  Each person pays ${money(total)}` : 'Itinerary: nothing added yet',
        recs?.[0] ? `Latest Grok write-up: ${recs[0].summary}` : '',
        s.owe ? `You owe ${money(s.owe)} — pay it with your PIN in the Pact app.` : '',
      ].filter(Boolean)
      return { text: lines.join('\n'), data: { pact, members, items: list, stage: s.stage, you_owe: s.owe } }
    }
    case 'create_pact': {
      const name = text(args.name, 80)
      need(name, 'Give the pact a name.')
      const { data: id, error } = await db.rpc('create_pact', { p_name: name, p_description: text(args.about, 500) || null, p_budget: typeof args.budget_each === 'number' ? args.budget_each : null })
      need(!error && id, "Couldn't create the pact.")
      const kind = PACT_KINDS.includes(String(args.kind)) ? String(args.kind) : 'trip'
      const start = day(args.starts_on)
      await db.rpc('set_pact_details', {
        p_pact_id: id, p_type: kind, p_description: text(args.about, 500), p_location: text(args.location, 120),
        p_starts_on: start, p_ends_on: start ? (day(args.ends_on) ?? start) : null,
        p_budget: typeof args.budget_each === 'number' ? args.budget_each : null, p_link: '',
      })
      return { text: `Created "${name}" (${id}). You're the coordinator. Invite friends from the Pact app, then add itinerary items.`, data: { pact_id: id } }
    }
    case 'add_item': {
      const id = text(args.pact_id, 40)
      await memberOf(db, id)
      need(KINDS.includes(String(args.kind)), `kind must be one of ${KINDS.join(', ')}.`)
      const title = text(args.title, 120)
      need(title, 'Give the item a title.')
      const link = text(args.link, 500)
      need(!link || /^https?:\/\//i.test(link), 'link must start with https://')
      const start = day(args.starts_on)
      const { error } = await db.from('pact_items').insert({
        pact_id: id, kind: args.kind, title, location: text(args.location, 120) || null,
        starts_on: start, ends_on: start ? (day(args.ends_on) ?? start) : null,
        link: link || null, price_each: typeof args.price_each === 'number' && args.price_each >= 0 ? args.price_each : null, source: 'grok',
      })
      need(!error, /row-level security/i.test(error?.message ?? '') ? 'Items are locked once the split is set up.' : "Couldn't add that item.")
      return { text: `Added ${args.kind} "${title}"${typeof args.price_each === 'number' ? ` at ${money(args.price_each)} each` : ''}.` }
    }
    case 'post_message': {
      const id = text(args.pact_id, 40)
      await memberOf(db, id)
      const body = text(args.text, 2000)
      need(body, 'The message is empty.')
      const { error } = await db.from('pact_messages').insert({ pact_id: id, body })
      need(!error, "Couldn't post the message.")
      return { text: 'Posted to the pact chat.' }
    }
    case 'propose_booking': {
      const id = text(args.pact_id, 40)
      const pact = await memberOf(db, id)
      const { data: items } = await db.from('pact_items').select('kind, title, starts_on, price_each, link').eq('pact_id', id)
      const list = (items ?? []) as { kind: string; title: string; starts_on: string | null; price_each: number | null; link: string | null }[]
      const priced = list.filter((i) => i.price_each != null)
      need(priced.length, 'Add at least one item with a price first.')
      const total = priced.reduce((n, i) => n + Number(i.price_each), 0)
      const option = {
        title: pact.name,
        description: list.map((i) => [`${i.kind}: ${i.title}`, i.starts_on, i.price_each != null ? `${money(Number(i.price_each))} each` : null].filter(Boolean).join(' · ')).join('\n'),
        tradeoff: '', price_per_person: total, link: list.find((i) => i.link)?.link ?? null,
      }
      const { data: rec, error } = await db.rpc('save_pact_recommendation', {
        p_pact_id: id, p_summary: `Everything you're booking: ${list.length} item${list.length === 1 ? '' : 's'}, ${money(total)} each.`,
        p_options: [option], p_tasks: [], p_costs: [], p_next_steps: ['Everyone approves', 'Everyone pays their share with their PIN'],
      })
      need(!error, "Couldn't put it up for approval.")
      const recommendationId = typeof rec === 'string' ? rec : (rec as { recommendation_id?: string } | null)?.recommendation_id
        ?? (await db.from('pact_recommendations').select('recommendation_id').eq('pact_id', id).order('created_at', { ascending: false }).limit(1)).data?.[0]?.recommendation_id
      const { error: voteError } = await db.rpc('create_pact_decision', {
        p_pact_id: id, p_question: `Book ${pact.name}?`, p_options: ['Approve', 'Not yet'], p_approval_rule: 'unanimous', p_recommendation_id: recommendationId,
      })
      need(!voteError, "The write-up is saved, but the approval couldn't start.")
      return { text: `Put "${pact.name}" up for approval at ${money(total)} each. Everyone approves in the Pact app; nobody pays until they all do.` }
    }
    case 'payment_status': {
      const id = text(args.pact_id, 40)
      await memberOf(db, id)
      const [{ data: rows }, { data: members }] = await Promise.all([
        db.rpc('get_pact_payment_status', { p_pact_id: id }),
        db.rpc('list_pact_members', { p_pact_id: id }),
      ])
      const shares = (rows ?? []) as { payment_status: string; share_usdc: number; user_id: string | null; share_status: string | null }[]
      if (!shares.length) return { text: "No split yet. It's set up once everyone approves the booking." }
      const who = (uid: string | null) => uid === me.id ? 'You' : ((members ?? []) as { user_id: string; name: string | null }[]).find((m) => m.user_id === uid)?.name ?? 'Someone'
      const people = shares.filter((r) => r.user_id)
      return {
        text: [`Split: ${money(Number(shares[0].share_usdc))} each, ${shares[0].payment_status}`, ...people.map((r) => `• ${who(r.user_id)}: ${r.share_status === 'paid' ? 'paid' : r.share_status ?? 'owed'}`)].join('\n'),
        data: people,
      }
    }
  }
  throw new ToolError(`Unknown tool: ${name}`)
}

// ---- JSON-RPC over Streamable HTTP (single requests and batches; no server-sent events needed)

const reply = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', ...extra } })

async function handle(msg: Json, me: Me) {
  const id = msg.id ?? null
  const method = String(msg.method ?? '')
  if (msg.id === undefined) return null // a notification needs no answer
  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: typeof (msg.params as Json)?.protocolVersion === 'string' ? (msg.params as Json).protocolVersion : PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'pact', title: 'Pact', version: '1.0.0' },
          instructions: `You're helping ${me.name} plan group trips in Pact. Read pacts with list_pacts and get_pact, build the itinerary with add_item, and put it up for approval with propose_booking. You can't pay or move money: everyone pays their own share with their PIN in the Pact app.`,
        },
      }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} }
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools } }
    case 'tools/call': {
      const params = (msg.params ?? {}) as { name?: string; arguments?: Json }
      try {
        const out = await call(String(params.name), params.arguments ?? {}, me)
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: out.text }], ...(out.data !== undefined ? { structuredContent: { result: out.data } } : {}) } }
      } catch (e) {
        const message = e instanceof ToolError ? e.message : 'Something went wrong in Pact. Try again.'
        if (!(e instanceof ToolError)) console.error('[pact-mcp]', params.name, e)
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: message }], isError: true } }
      }
    }
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } }
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') return reply({ error: 'Pact MCP takes POST requests (Streamable HTTP).' }, 405, { Allow: 'POST, OPTIONS' })
  const me = await signIn(request)
  if (!me) return reply({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Make a token in Pact (Connect Grok) and send it as: Authorization: Bearer pact_…' } }, 401, { 'WWW-Authenticate': 'Bearer realm="pact"' })
  let body: unknown
  try { body = await request.json() } catch { return reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400) }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(m as Json, me)))).filter(Boolean)
    return out.length ? reply(out) : new Response(null, { status: 202, headers: cors })
  }
  const out = await handle(body as Json, me)
  return out ? reply(out) : new Response(null, { status: 202, headers: cors })
})
