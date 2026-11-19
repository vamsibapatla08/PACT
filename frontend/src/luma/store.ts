// The iOS app's logic, ported for the web: the same tables, functions and steps as ios/Pact_App/Core.
import { supabase as maybeClient } from '../lib/supabase'
import { createPactMoneyWallet, runPactAction, sendPactMoney } from '../lib/pactMoneyService'

export const supabase = maybeClient!

export type Pact = {
  pact_id: string; name: string; description: string | null; budget: number | null; status: string
  created_by: string | null; created_at: string
  pact_type: string | null; location: string | null; starts_on: string | null; ends_on: string | null; link: string | null
}
export type Member = { user_id: string; role: string; name: string | null; avatar_url: string | null }
export type Message = { message_id: string; pact_id: string; sender_id: string; body: string; created_at: string }
export type Option = { title: string; description: string; tradeoff: string; price_per_person?: number | null; link?: string | null }
export type Cost = { item: string; estimated_amount: number; per_person_amount?: number | null; option_title?: string | null; is_shared?: boolean | null }
export type Recommendation = { recommendation_id: string; summary: string; options: Option[]; costs: Cost[]; next_steps: string[]; created_at: string }
export type Decision = {
  decision_id: string; recommendation_id: string | null; question: string; options: string[]; approval_rule: string
  status: string; created_at: string; approvals: number; rejects: number; eligible: number; myVote: string | null
  /** Everyone's vote so far: user_id -> 'approve' | 'reject'. Pact members can see each other's votes. */
  votes: Record<string, string>
}
export type Chain = {
  state: string; payee?: string | null; sharesPaid: number; sharesNeeded: number; funded: boolean
  share: { usdc: string }; total: { usdc: string }; members: { userId: string; role: string; address: string | null; paid: boolean }[]
}
export type FundingPlan = { payee_address: string; share_usdc: number; shares_needed: number; deadline: string }
export type Wallet = { address: string; usdcBalance: string | null }
export type Item = {
  item_id: string; kind: ItemKind; title: string; location: string | null; starts_on: string | null; ends_on: string | null
  link: string | null; price_each: number | null; source: string; created_by: string
}
export type FriendRequest = { request_id: string; incoming: boolean; user_id: string; name: string | null; email: string | null; avatar_url: string | null }
export type PactInvite = { pact_id: string; pact_name: string; inviter_name: string | null; inviter_avatar_url: string | null; member_count: number }
export type JoinRequest = { user_id: string; name: string | null; avatar_url: string | null }
export type PersonResult = { user_id: string; name: string | null; avatar_url: string | null; status: 'friend' | 'requested' | 'asked_you' | 'none' }
export type Transfer = { transfer_id: string; sender_id: string; recipient_id: string; amount_usdc: number; status: string; created_at: string }

export type PactKind = 'trip' | 'event' | 'stay' | 'dinner' | 'other'
export const pactKinds: PactKind[] = ['trip', 'event', 'stay', 'dinner', 'other']
export type ItemKind = 'stay' | 'flight' | 'ticket' | 'dinner' | 'other'
export const itemTitle = (k: ItemKind) => (k === 'ticket' ? 'Tickets' : cap(k))
export const presets: Record<PactKind, ItemKind[]> = {
  trip: ['flight', 'stay', 'ticket', 'dinner', 'other'], event: ['ticket', 'stay', 'dinner', 'other'],
  stay: ['stay', 'other'], dinner: ['dinner', 'other'], other: ['stay', 'flight', 'ticket', 'dinner', 'other'],
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
export const firstName = (name?: string | null) => name?.split(' ')[0] || 'Someone'
export const dollars = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`

/** Where a pact is up to, from my side: the one thing I can do, or what we're waiting on. Same as iOS PactStep. */
export type Step =
  | { kind: 'talk' } | { kind: 'declined' }
  | { kind: 'approve'; decision: Decision } | { kind: 'waitingApprovals'; approved: number; of: number }
  | { kind: 'needsWallet' } | { kind: 'settingUp' } | { kind: 'waitSetup'; host: string }
  | { kind: 'startCollecting' } | { kind: 'waitStart'; host: string } | { kind: 'checking' }
  | { kind: 'pay'; amount: number } | { kind: 'waitPay'; paid: number; of: number }
  | { kind: 'finalise'; total: number } | { kind: 'waitFinalise'; host: string }
  | { kind: 'done'; total: number; host: string } | { kind: 'cancelled' }

export type PactData = {
  members: Member[]
  recommendations: Recommendation[]
  decisions: Decision[]
  plan: FundingPlan | null
  chain: Chain | null
  items: Item[]
  joinRequests: JoinRequest[]
  /** What QuickNode has recorded: each share's payment (with its transaction once confirmed) and the release. */
  receipts: Receipt[]
  events: PaymentEvent[]
}
export type Receipt = { user_id: string; status: string; tx_hash: string | null; paid_at: string | null }
export type PaymentEvent = { event_type: string; tx_hash: string; block_number: number | null; created_at: string }

const bookingQuestion = `Find the one thing our group agreed to book in the chat above. Use any link and price someone shared. \
Return it as the only option, with price_per_person for each of us and its link. Don't suggest other places.`
const itemsQuestion = `List each thing our group agreed to book in the chat above as its own option: a stay, a flight, tickets or a dinner. \
Give each its price_per_person and link. Don't add anything we didn't agree on.`
export const summaryQuestion = "Sum up where our group stands. Use the pact's saved details (place, dates, budget, people, the plan and who has paid) as well as the chat. Say what is decided and what is still missing. Don't suggest places."

export function friendly(error: unknown, fallback: string) {
  const text = String((error as { message?: string })?.message ?? error).toLowerCase()
  if (text.includes('row-level security') || text.includes('permission denied') || text.includes('42501')) return "You don't have permission to do that."
  if (text.includes('failed to fetch') || text.includes('network')) return "Pact can't reach the server. Check your connection."
  return fallback
}

/** Calls an Edge Function as me. A 4xx comes back as its readable `error`. */
async function invoke<T>(fn: string, body: Record<string, unknown>, retried = false): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body })
  if (error) {
    const response = (error as { context?: unknown }).context
    // A 401 means this browser's session was ended (often by signing out on another device). Try a fresh session
    // once; if there isn't one, sign out here only, so the app shows the sign-in screen instead of an error.
    if (response instanceof Response && response.status === 401 && !retried) {
      const { error: refreshError } = await supabase.auth.refreshSession()
      if (!refreshError) return invoke<T>(fn, body, true)
      await supabase.auth.signOut({ scope: 'local' })
      throw new Error('You were signed out. Sign in again to keep going.')
    }
    if (response instanceof Response) {
      const reply = await response.clone().json().catch(() => null) as { error?: string } | null
      if (reply?.error) throw new Error(reply.error)
    }
    throw error
  }
  return data as T
}
const said = (e: unknown, fallback: string) => (e instanceof Error && e.message && !/edge function|non-2xx/i.test(e.message) ? e.message : fallback)

// ---- Pacts

export async function loadPacts(me: string): Promise<Pact[]> {
  const { data: rows, error } = await supabase.from('pact_members').select('pact_id').eq('user_id', me).eq('membership_status', 'active')
  if (error) throw error
  const ids = [...new Set((rows ?? []).map((r) => r.pact_id as string))]
  if (!ids.length) return []
  const { data, error: e2 } = await supabase.from('pacts').select('*').in('pact_id', ids).order('created_at', { ascending: false })
  if (e2) throw e2
  return data as Pact[]
}

export async function loadMembers(id: string): Promise<Member[]> {
  const { data } = await supabase.rpc('list_pact_members', { p_pact_id: id })
  return (data ?? []) as Member[]
}

export async function loadPlan(id: string, me: string) {
  const [{ data: recs }, { data: rows }, { data: counts }] = await Promise.all([
    supabase.from('pact_recommendations').select('recommendation_id, summary, options, costs, next_steps, created_at').eq('pact_id', id).order('created_at', { ascending: false }),
    supabase.from('pact_decisions').select('decision_id, recommendation_id, question, options, approval_rule, status, created_at').eq('pact_id', id).order('created_at', { ascending: false }),
    supabase.rpc('get_pact_decision_counts', { p_pact_id: id }),
  ])
  const decisions = (rows ?? []) as Decision[]
  const votes = decisions.length
    ? (await supabase.from('pact_decision_votes').select('decision_id, user_id, vote').in('decision_id', decisions.map((d) => d.decision_id))).data ?? []
    : []
  for (const d of decisions) {
    const c = (counts ?? []).find((x: { decision_id: string }) => x.decision_id === d.decision_id)
    d.approvals = c?.approve_count ?? 0; d.rejects = c?.reject_count ?? 0; d.eligible = c?.eligible_count ?? 0
    d.votes = Object.fromEntries(votes.filter((v) => v.decision_id === d.decision_id).map((v) => [v.user_id, v.vote]))
    d.myVote = d.votes[me] ?? null
  }
  return { recommendations: ((recs ?? []) as Recommendation[]).map((r) => ({ ...r, options: r.options ?? [], costs: r.costs ?? [] })), decisions }
}

export async function loadSplit(id: string) {
  const [{ data }, { data: events }] = await Promise.all([
    supabase.rpc('get_pact_payment_status', { p_pact_id: id }),
    supabase.from('pact_payment_events').select('event_type, tx_hash, block_number, created_at').eq('pact_id', id),
  ])
  const rows = (Array.isArray(data) ? data : []) as (FundingPlan & { user_id: string | null; share_status: string; tx_hash: string | null; paid_at: string | null })[]
  const plan = rows[0] ?? null
  const receipts: Receipt[] = rows.filter((r) => r.user_id).map((r) => ({ user_id: r.user_id!, status: r.share_status, tx_hash: r.tx_hash, paid_at: r.paid_at }))
  // With no split saved there's no pact on PactSplit yet, so skip the blockchain read (the slowest call here).
  if (!plan) return { plan, chain: null, receipts, events: (events ?? []) as PaymentEvent[] }
  const read = () => invoke<Chain>('wallet', { action: 'pact_status', pactId: id })
  const chain = await read().catch(() => new Promise((ok) => setTimeout(ok, 900)).then(read)).catch(() => null)
  return { plan, chain, receipts, events: (events ?? []) as PaymentEvent[] }
}

/** The tables a pact page listens to live (each has a pact_id). Turned on for realtime in the
 *  20261118130000_realtime_pact_changes migration. */
export const LIVE_PACT_TABLES = [
  'pact_polls', 'pact_items', 'pact_decisions', 'pact_recommendations', 'pact_payments', 'pact_shares',
  'pact_members', 'pact_expenses', 'pact_settlements', 'pact_tab_paybacks', 'pact_extras_rounds',
] as const

/** Run fn at most `limit` at a time over items, so a long list never floods the database all at once. */
export async function inBatches<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++])
  }))
}

/** Run fn every ms while this tab is on screen, and once straight away when you come back to it. Background tabs
 *  stay quiet, so a pact left open in another tab doesn't keep hitting the database. Returns the cleanup. */
export function pollWhileVisible(fn: () => void, ms: number) {
  const shown = () => document.visibilityState === 'visible'
  const timer = setInterval(() => { if (shown()) fn() }, ms)
  const back = () => { if (shown()) fn() }
  document.addEventListener('visibilitychange', back)
  return () => { clearInterval(timer); document.removeEventListener('visibilitychange', back) }
}

export async function loadItems(id: string): Promise<Item[]> {
  const cols = 'item_id, kind, title, location, starts_on, ends_on, link, price_each, source, created_by'
  const order = <T extends { order: (c: string, o: object) => T }>(q: T) => q.order('starts_on', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true })
  let { data, error } = await order(supabase.from('pact_items').select(cols).eq('pact_id', id).eq('extra', false))
  // Before the extras migration is live there's no "extra" column: load every item, as before.
  if (error && /extra/.test(error.message)) ({ data } = await order(supabase.from('pact_items').select(cols).eq('pact_id', id)))
  return (data ?? []).map((i) => ({ ...i, price_each: i.price_each == null ? null : Number(i.price_each) })) as Item[]
}

export async function loadJoinRequests(id: string): Promise<JoinRequest[]> {
  const { data } = await supabase.rpc('list_pact_join_requests', { p_pact_id: id })
  return (data ?? []) as JoinRequest[]
}

export async function loadPactData(id: string, me: string): Promise<PactData> {
  const [members, plan, split, items, joinRequests] = await Promise.all([loadMembers(id), loadPlan(id, me), loadSplit(id), loadItems(id), loadJoinRequests(id)])
  return { members, ...plan, plan: split.plan, chain: split.chain, receipts: split.receipts, events: split.events, items, joinRequests }
}

export const coordinator = (d: Pick<PactData, 'members'>) => d.members.find((m) => m.role === 'host') ?? null

export function booking(d: PactData) {
  // The plan the group is voting on (or approved) stays in charge, even if Pact Pilot writes a newer summary afterwards.
  // Recommendations are newest first, so a plan sent for approval later still wins. With no vote yet, the newest one.
  const voted = d.recommendations.find((r) => d.decisions.some((x) => x.recommendation_id === r.recommendation_id && x.status !== 'rejected'))
  const rec = voted ?? d.recommendations[0]
  const option = rec?.options[0]
  if (!rec || !option) return null
  const people = Math.max(1, d.members.length)
  const perPerson = option.price_per_person ?? perPersonFromCosts(rec, option)
  return { rec, option, people, perPerson, total: perPerson == null ? null : perPerson * people, question: `Book ${option.title}?` }
}
export type Booking = NonNullable<ReturnType<typeof booking>>

function perPersonFromCosts(rec: Recommendation, option: Option) {
  const counted = rec.costs.filter((c) => c.is_shared === true || c.option_title == null || c.option_title === option.title)
  const amounts = counted.map((c) => c.per_person_amount).filter((x): x is number => x != null)
  return amounts.length && amounts.length === counted.length ? amounts.reduce((a, b) => a + b, 0) : null
}

export const consent = (d: PactData, b: Booking) => d.decisions.find((x) => x.recommendation_id === b.rec.recommendation_id) ?? null

export function step(d: PactData, me: string, hasWallet: boolean): Step {
  const c = coordinator(d)
  const host = c ? (c.user_id === me ? 'you' : firstName(c.name)) : 'the coordinator'
  const iCoordinate = c?.user_id === me
  const chain = d.chain
  if (chain && chain.state !== 'none') {
    const total = Number(chain.total.usdc) || 0
    if (chain.state === 'released') return { kind: 'done', total, host }
    if (chain.state === 'cancelled') return { kind: 'cancelled' }
    const mine = chain.members.find((m) => m.userId === me)
    if (mine?.address && !mine.paid) return { kind: 'pay', amount: Number(chain.share.usdc) || 0 }
    if (chain.funded) return iCoordinate ? { kind: 'finalise', total } : { kind: 'waitFinalise', host }
    return { kind: 'waitPay', paid: chain.sharesPaid, of: chain.sharesNeeded }
  }
  // The split is saved. If PactSplit couldn't be read just now, don't guess "not started": say we're checking.
  if (d.plan && !chain) return { kind: 'checking' }
  if (d.plan) return iCoordinate ? { kind: 'startCollecting' } : { kind: 'waitStart', host }
  const b = booking(d)
  const k = b && consent(d, b)
  if (!k) return { kind: 'talk' }
  if (k.status === 'approved') return !iCoordinate ? { kind: 'waitSetup', host } : hasWallet ? { kind: 'settingUp' } : { kind: 'needsWallet' }
  if (k.status === 'rejected') return { kind: 'declined' }
  return k.myVote == null ? { kind: 'approve', decision: k } : { kind: 'waitingApprovals', approved: k.approvals, of: k.eligible }
}

/** The step as a line of text, and whether it's mine to do. Same wording as the iOS floating step. */
export function stepLabel(s: Step, hasGrok: boolean): { text: string; action: boolean } {
  switch (s.kind) {
    case 'talk': return { text: hasGrok ? 'Planning' : 'Set up with Pact Pilot', action: !hasGrok }
    case 'declined': return { text: 'Set up with Pact Pilot again', action: true }
    case 'approve': return { text: 'Approve', action: true }
    case 'needsWallet': return { text: 'Set my PIN to collect', action: true }
    case 'startCollecting': return { text: 'Start collecting', action: true }
    case 'pay': return { text: `Approve ${dollars(s.amount)}`, action: true }
    case 'finalise': return { text: `Finalise and book · ${dollars(s.total)}`, action: true }
    case 'waitingApprovals': return { text: `You approved · ${s.approved} of ${s.of}`, action: false }
    case 'settingUp': return { text: 'Setting up the split', action: false }
    case 'waitSetup': return { text: `Waiting for ${s.host} to set up the split`, action: false }
    case 'waitStart': return { text: `Waiting for ${s.host} to start collecting`, action: false }
    case 'checking': return { text: 'Checking the latest from Arc…', action: false }
    case 'waitPay': return { text: `You're in · ${s.paid} of ${s.of} paid`, action: false }
    case 'waitFinalise': return { text: `Everyone's paid · waiting for ${s.host}`, action: false }
    case 'done': return { text: `Done · ${dollars(s.total)} to ${s.host}`, action: false }
    case 'cancelled': return { text: 'Cancelled · everyone can take their share back', action: false }
  }
}

/** A short chip for the timeline, like Luma's Going / Pending. */
export function chip(s: Step): { text: string; tone: 'go' | 'warn' | 'mute' } {
  switch (s.kind) {
    case 'done': return { text: 'Booked', tone: 'go' }
    case 'pay': return { text: `Owe ${dollars(s.amount)}`, tone: 'warn' }
    case 'approve': return { text: 'Approve', tone: 'warn' }
    case 'startCollecting': case 'finalise': case 'needsWallet': return { text: 'Your move', tone: 'warn' }
    case 'waitPay': return { text: `${s.paid} of ${s.of} paid`, tone: 'mute' }
    case 'waitFinalise': return { text: 'Everyone paid', tone: 'go' }
    case 'cancelled': return { text: 'Cancelled', tone: 'mute' }
    case 'waitingApprovals': return { text: `${s.approved} of ${s.of} approved`, tone: 'mute' }
    default: return { text: 'Planning', tone: 'mute' }
  }
}

export const owedIn = (d: PactData, me: string) => {
  const c = d.chain
  const mine = c?.members.find((m) => m.userId === me)
  return c?.state === 'open' && mine?.address && !mine.paid ? Number(c.share.usdc) || 0 : 0
}
export const collectingIn = (d: PactData, me: string) => {
  const c = d.chain
  if (coordinator(d)?.user_id !== me || c?.state !== 'open') return 0
  return (Number(c.share.usdc) || 0) * c.members.filter((m) => m.userId !== me && m.address && !m.paid).length
}

// ---- Dates

export const today = () => new Date().toISOString().slice(0, 10)
export const day = (s: string) => new Date(`${s}T12:00:00`)
export function dateRange(start: string | null, end: string | null) {
  if (!start) return null
  const f = (s: string) => day(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return !end || end === start ? f(start) : `${f(start)} – ${f(end)}`
}

// ---- Chat and Pact Pilot

export async function loadMessages(id: string): Promise<Message[]> {
  const { data } = await supabase.from('pact_messages').select('message_id, pact_id, sender_id, body, created_at')
    .eq('pact_id', id).order('created_at', { ascending: true }).order('message_id', { ascending: true })
  return (data ?? []) as Message[]
}

export async function send(id: string, body: string) {
  const text = body.trim()
  if (!text) return
  const { error } = await supabase.from('pact_messages').insert({ pact_id: id, body: text })
  if (error) throw new Error("Your message didn't send.")
}

/** The question, after as much of the newest chat as fits in PactPilot's 2,000 characters. */
function withChat(question: string, messages: Message[], name: (id: string) => string) {
  const tail = `\n\nQuestion: ${question}`
  const lines: string[] = []
  let room = 2000 - tail.length - 40
  for (const m of [...messages].reverse()) {
    const line = `${name(m.sender_id)}: ${m.body}`
    if (line.length + 1 > room) break
    lines.unshift(line); room -= line.length + 1
  }
  return lines.length ? `Our group chat so far:\n${lines.join('\n')}${tail}` : question.slice(0, 2000)
}

type Answer = { summary: string; options: Option[]; tasks?: unknown[]; costs?: Cost[]; next_steps?: string[] }

/** Called while Pact Pilot is on its second try, so the page can say so. */
export let onGrokRetry: (() => void) | null = null
export const setGrokRetryListener = (f: (() => void) | null) => { onGrokRetry = f }

async function askPilotRaw(id: string, question: string, messages: Message[], name: (id: string) => string) {
  // A summary is a quick read of the chat, so it asks for the faster model (when one is set up on the server).
  const ask = () => invoke<Answer>('pactpilot', { pact_id: id, question: withChat(question, messages, name), quick: question === summaryQuestion })
  try { return await ask() }
  catch (e) {
    // Pact Pilot sometimes runs past the function's time limit. One more try usually lands.
    if (!/timed out|request failed \(5\d\d\)|non-2xx|50[234]/i.test(String((e as Error).message))) throw e
    onGrokRetry?.()
    try { return await ask() }
    catch { throw new Error('Pact Pilot is slow right now and timed out twice. Try again in a minute.') }
  }
}

async function saveRecommendation(id: string, a: Answer) {
  const { error } = await supabase.rpc('save_pact_recommendation', {
    p_pact_id: id, p_summary: a.summary, p_options: a.options, p_tasks: a.tasks ?? [], p_costs: a.costs ?? [], p_next_steps: a.next_steps ?? [],
  })
  if (error) throw error
}

export async function askPilot(id: string, question: string, messages: Message[], name: (id: string) => string) {
  try { await saveRecommendation(id, await askPilotRaw(id, question, messages, name)) }
  catch (e) { throw new Error(said(e, "PactPilot couldn't answer that. Try again.")) }
}

async function createDecision(id: string, question: string, recommendationId: string) {
  const { error } = await supabase.rpc('create_pact_decision', {
    p_pact_id: id, p_question: question, p_options: ['Approve', 'Not yet'], p_approval_rule: 'unanimous', p_recommendation_id: recommendationId,
  })
  if (error) throw new Error("Couldn't start the vote.")
}

/** Pact Pilot reads the chat, writes up the one thing to book, and it goes to everyone to approve. */
export async function askGrokToBook(id: string, me: string, pact: Pact, messages: Message[], name: (id: string) => string) {
  // A vote the group already ticked is the clearest answer: the leading option goes on the plan and up for approval,
  // with no need for Pact Pilot to read the chat.
  const voted = (await loadPolls(id)).filter((p) => p.status === 'open' && Object.keys(p.votes).length > 0).at(-1)
  if (voted) {
    const count = (key: string) => Object.values(voted.votes).filter((v) => v === key).length
    const leader = [...voted.options].sort((a, b) => count(b.key) - count(a.key))[0]
    await addPollPickToPlan(pact, voted, leader)
    const fresh = await loadPactData(id, me)
    return bookItems(id, pact, fresh.items, me)
  }
  await askPilot(id, bookingQuestion, messages, name)
  const d = await loadPactData(id, me)
  const b = booking(d)
  if (!b) throw new Error("Nothing's agreed to book yet. Ask Pact Pilot to put a few options to a vote, or say in the chat what to book with the link and price.")
  if (consent(d, b)) return
  await createDecision(id, b.question, b.rec.recommendation_id)
  await importFromGrok(pact, d, me)
}

/** Pact Pilot's write-up fills in the link and price when the coordinator hasn't set them yet. */
async function importFromGrok(pact: Pact, d: PactData, me: string) {
  const b = booking(d)
  if (coordinator(d)?.user_id !== me || !b) return
  const details = detailsOf(pact)
  if (details.link && details.budget != null) return
  if (!details.link && b.option.link) details.link = b.option.link
  if (details.budget == null) details.budget = b.perPerson
  if (!details.about) details.about = b.option.title
  await saveDetails(pact.pact_id, details).catch(() => undefined)
}

export async function vote(decision: Decision, approve: boolean) {
  const { error } = await supabase.rpc('cast_pact_decision_vote', { p_decision_id: decision.decision_id, p_vote: approve ? 'approve' : 'reject' })
  if (error) throw new Error("Your vote didn't count. Try again.")
}

/** Approving needs a wallet, so the split can include me. The first approve sets one up. */
export async function approve(decision: Decision, wallet: Wallet | null) {
  if (!wallet) await createPactMoneyWallet()
  await vote(decision, true)
}

/** Once everyone approves, the coordinator saves the split: the price each, paid to them, due in a week. */
export async function setUpSplit(id: string, d: PactData, wallet: Wallet) {
  const b = booking(d)
  if (!b || b.perPerson == null) throw new Error("Pact Pilot's card has no price yet. Ask Pact Pilot again with the price in the chat.")
  try {
    await invoke('create-pact-payment-plan', {
      pactId: id, shareUsdc: String(Math.round(b.perPerson * 100) / 100),
      deadline: new Date(Date.now() + 7 * 864e5).toISOString(), payeeAddress: wallet.address,
    })
  } catch (e) { throw new Error(said(e, "Couldn't save the plan.")) }
}

export async function pactAction(action: 'create_pact' | 'pay_share' | 'release', id: string) {
  try { return await runPactAction(action, id) }
  catch (e) { throw new Error(said(e, "That didn't go through.")) }
}

// ---- Details, people and items

export type Details = { kind: PactKind; about: string; location: string; startsOn: string | null; endsOn: string | null; budget: number | null; link: string }

export function detailsOf(p: Pact): Details {
  return {
    kind: (pactKinds.includes(p.pact_type as PactKind) ? p.pact_type : 'trip') as PactKind,
    about: p.description ?? '', location: p.location ?? '', startsOn: p.starts_on, endsOn: p.ends_on ?? p.starts_on,
    budget: p.budget == null ? null : Number(p.budget), link: p.link ?? '',
  }
}

const withScheme = (link: string) => (!link.trim() || /^https?:/i.test(link.trim()) ? link.trim() : `https://${link.trim()}`)

/** The coordinator renames the pact. Returns the cleaned-up name. */
export async function renamePact(id: string, name: string) {
  const { data, error } = await supabase.rpc('rename_pact', { p_pact_id: id, p_name: name })
  if (error) throw new Error(/coordinator|1 to 80/.test(error.message) ? error.message : "Couldn't rename the pact.")
  return data as string
}

export async function saveDetails(id: string, d: Details) {
  const end = d.startsOn && d.endsOn && d.endsOn < d.startsOn ? d.startsOn : d.endsOn
  const { error } = await supabase.rpc('set_pact_details', {
    p_pact_id: id, p_type: d.kind, p_description: d.about, p_location: d.location,
    p_starts_on: d.startsOn, p_ends_on: d.startsOn ? end ?? d.startsOn : null, p_budget: d.budget, p_link: withScheme(d.link),
  })
  if (error) throw new Error("Couldn't save the details.")
}

/** Makes the pact, saves its details, and asks the picked friends in. */
export async function createPact(name: string, d: Details, friendIds: string[]) {
  const { data, error } = await supabase.rpc('create_pact', { p_name: name.trim(), p_description: d.about.trim() || null, p_budget: d.budget })
  if (error) throw new Error("Couldn't create the pact.")
  const id = (Array.isArray(data) ? data[0]?.pact_id ?? data[0] : (data as { pact_id?: string })?.pact_id ?? data) as string
  await saveDetails(id, d).catch(() => undefined)
  if (friendIds.length) await invite(id, friendIds)
  return id
}

export async function invite(id: string, userIds: string[]) {
  const { error } = await supabase.rpc('invite_to_pact', { p_pact_id: id, p_user_ids: userIds })
  if (error) throw new Error("Couldn't ask them in.")
}

/** The coordinator deletes the pact for everyone. */
export async function deletePact(id: string) {
  const { error } = await supabase.rpc('delete_pact', { p_pact_id: id })
  if (error) throw new Error(/PGRST202|schema cache/i.test(error.message) ? 'Deleting needs the latest database update.' : (/P0001|42501/.test(error.code ?? '') ? error.message : "Couldn't delete the pact."))
}

/** Leave a pact. You can be asked back in later. */
export async function leavePact(id: string) {
  const { error } = await supabase.rpc('leave_pact', { p_pact_id: id })
  if (error) throw new Error(/PGRST202|schema cache/i.test(error.message) ? 'Leaving needs the latest database update.' : (/P0001|42501/.test(error.code ?? '') ? error.message : "Couldn't leave the pact."))
}

export async function removeMember(id: string, userId: string) {
  const { error } = await supabase.rpc('remove_pact_member', { p_pact_id: id, p_user_id: userId })
  if (error) throw new Error(/locked/i.test(error.message) ? 'People are locked once the split is set up.' : "Couldn't remove them.")
}

export function guessKind(title: string): ItemKind {
  const t = title.toLowerCase()
  const has = (words: string[]) => words.some((w) => t.includes(w))
  if (has(['flight', 'fly', 'airline', 'plane'])) return 'flight'
  if (has(['hotel', 'stay', 'airbnb', 'room', 'house', 'loft', 'hostel'])) return 'stay'
  if (has(['ticket', 'event', 'show', 'concert', 'game', 'festival', 'pass'])) return 'ticket'
  if (has(['dinner', 'lunch', 'brunch', 'restaurant', 'meal'])) return 'dinner'
  return 'other'
}

export type ItemDraft = { kind: ItemKind; title: string; location: string; startsOn: string | null; endsOn: string | null; link: string; price: number | null }

/** Add to the plan. Once the split is set up, the plan is locked, so new things go in as extras instead. */
export async function addItem(id: string, d: ItemDraft, source: 'manual' | 'grok' = 'manual', extra = false) {
  const { error } = await supabase.from('pact_items').insert({
    pact_id: id, kind: d.kind, title: d.title.trim(), location: d.location.trim() || null,
    starts_on: d.startsOn, ends_on: d.startsOn ? (d.endsOn && d.endsOn >= d.startsOn ? d.endsOn : d.startsOn) : null,
    link: withScheme(d.link) || null, price_each: d.price, source, extra,
  })
  if (error) throw new Error(/row-level security/i.test(error.message) ? (extra ? "Couldn't add that extra." : 'The split is set up, so add it as an extra.') : "Couldn't add that item.")
}

// ---- Extras: things added after the split is locked. The group approves a round of them, then each person pays
// the coordinator their share directly (PIN). The first split stays as it is.

export type ExtraItem = { item_id?: string; kind: ItemKind; title: string; price_each: number | null; link: string | null; created_by?: string }
export type ExtrasRound = { round_id: string; status: 'open' | 'approved'; share_cents: number; created_at: string; items: ExtraItem[]; votes: Record<string, 'approve' | 'reject'>; paid: string[] }
export type Extras = { host: string | null; unsent: ExtraItem[]; rounds: ExtrasRound[] }

export async function loadExtras(id: string): Promise<Extras> {
  const { data, error } = await supabase.rpc('get_pact_extras', { p_pact_id: id })
  if (error) throw new Error("Couldn't load the extras.")
  return data as Extras
}

export async function sendExtrasForApproval(id: string) {
  const { error } = await supabase.rpc('send_pact_extras_for_approval', { p_pact_id: id })
  if (error) throw new Error(said(error, "Couldn't send the extras for approval."))
}

export async function voteExtras(roundId: string, approve: boolean) {
  const { error } = await supabase.rpc('vote_pact_extras', { p_round_id: roundId, p_approve: approve })
  if (error) throw new Error(said(error, "Your vote didn't count. Try again."))
}

/** Pay my share of an approved extras round to the coordinator. It's marked for the round before the PIN. */
export async function payExtras(id: string, roundId: string, host: string, amountCents: number) {
  const requestId = crypto.randomUUID()
  const { error } = await supabase.rpc('mark_pact_extras_payment', { p_round_id: roundId, p_request_id: requestId })
  if (error) throw new Error(said(error, "Couldn't start the payment."))
  await sendTo(id, host, amountCents, requestId)
}

// ---- Vote cards: a few options (hotels, flights…) the group picks from. One vote each, changeable.

export type PollOption = { key: string; name: string; price_each: number | null; link: string | null; notes: string | null; image?: string | null }
export type Poll = {
  poll_id: string; pact_id: string; title: string; kind: ItemKind; options: PollOption[]; status: 'open' | 'closed'
  source: 'manual' | 'grok'; created_by: string; created_at: string
  votes: Record<string, string> // user_id -> option key
}

export async function loadPolls(id: string): Promise<Poll[]> {
  const { data: polls, error } = await supabase.from('pact_polls').select('*').eq('pact_id', id).order('created_at')
  if (error || !polls?.length) return []
  const { data: votes } = await supabase.from('pact_poll_votes').select('poll_id, user_id, option_key').in('poll_id', polls.map((p) => p.poll_id))
  return polls.map((p) => ({
    ...p,
    options: (p.options as PollOption[]).map((o) => ({ ...o, price_each: o.price_each == null ? null : Number(o.price_each) })),
    votes: Object.fromEntries((votes ?? []).filter((v) => v.poll_id === p.poll_id).map((v) => [v.user_id, v.option_key])),
  })) as Poll[]
}

/** Start a vote from a list of options (for example one Pact Pilot posted as a chat message). */
export async function startPoll(id: string, title: string, options: Omit<PollOption, 'key'>[], kind: ItemKind = 'other') {
  const { data, error } = await supabase.rpc('create_pact_poll', { p_pact_id: id, p_title: title.slice(0, 120), p_options: options, p_kind: kind, p_source: 'manual' })
  if (error) throw new Error(/PGRST202|schema cache|does not exist/i.test(error.message) ? "Votes aren't switched on yet. Run the database update first." : "Couldn't start the vote.")
  return data as string
}

/** Reads a numbered list of options out of a chat message, like Pact Pilot's "1. Holiday Inn Express: ~$222 each … https://…
 *  2. Hilton…". Returns null for an ordinary message. */
export function parseOptions(text: string): { title: string; options: Omit<PollOption, 'key'>[] } | null {
  const parts = text.split(/(?:^|\s)(\d{1,2})[.)]\s+(?=\S)/)
  if (parts.length < 5) return null // a title plus at least two numbered options
  const title = parts[0].replace(/\s+/g, ' ').replace(/\bvote!?\s*/i, '').replace(/:\s*\(/, ' (').trim().replace(/[:\-–—]\s*$/, '') || 'Options'
  const options: Omit<PollOption, 'key'>[] = []
  for (let i = 1; i + 1 < parts.length; i += 2) {
    let body = parts[i + 1].trim()
    const link = body.match(/https?:\/\/[^\s)]+/)?.[0]?.replace(/[.,;]+$/, '') ?? null
    if (link) body = body.replace(link, ' ')
    const colon = body.indexOf(':')
    const name = (colon > 0 && colon < 90 ? body.slice(0, colon) : body.split(/[,.(–—-]/)[0]).trim()
    const rest = colon > 0 && colon < 90 ? body.slice(colon + 1) : body.slice(name.length)
    const each = rest.match(/~?\$\s?([\d,]+(?:\.\d+)?)\s*(?:\/\s*(?:person|pp)|each|per person|pp)/i) ?? rest.match(/~?\$\s?([\d,]+(?:\.\d+)?)/)
    const notes = rest.replace(/\s+/g, ' ').replace(/^[\s,.;:–—-]+|[\s,.;:–—-]+$/g, '').slice(0, 160) || null
    if (!name || name.length > 90) return null
    options.push({ name, price_each: each ? Number(each[1].replace(/,/g, '')) : null, link, notes })
  }
  if (options.length < 2 || options.length > 8 || !options.some((o) => o.link || o.price_each != null)) return null
  return { title: title.slice(0, 120), options }
}

/** Vote for an option; voting for the one I already picked takes my vote back. */
export async function votePoll(pollId: string, key: string) {
  const { error } = await supabase.rpc('vote_pact_poll', { p_poll_id: pollId, p_option_key: key })
  if (error) throw new Error(/closed|not in this vote|Only people/.test(error.message) ? error.message : "Couldn't save your vote.")
}

export async function closePoll(pollId: string) {
  const { error } = await supabase.rpc('close_pact_poll', { p_poll_id: pollId })
  if (error) throw new Error(/Only whoever/.test(error.message) ? error.message : "Couldn't close the vote.")
}

/** The picked option goes onto the plan as an item, priced per person, with its link. Once the split is set up the
 *  plan is locked, so it goes in as an extra for the group to approve instead. Returns true when it went in as an extra. */
export async function addPollPickToPlan(pact: Pact, poll: Poll, option: PollOption, locked = false) {
  const draft: ItemDraft = {
    kind: poll.kind, title: option.name, location: pact.location ?? '', startsOn: pact.starts_on, endsOn: pact.ends_on,
    link: option.link ?? '', price: option.price_each,
  }
  const source = poll.source === 'grok' ? 'grok' : 'manual'
  let extra = locked
  try { await addItem(pact.pact_id, draft, source, extra) }
  catch (e) {
    // The split was set up after this page last loaded: the plan is locked, so add it as an extra.
    if (extra || !/add it as an extra/.test((e as Error).message)) throw e
    extra = true
    await addItem(pact.pact_id, draft, source, true)
  }
  await closePoll(poll.poll_id).catch(() => undefined)
  return extra
}

export async function removeItem(itemId: string) {
  const { error } = await supabase.from('pact_items').delete().eq('item_id', itemId)
  if (error) throw new Error("Couldn't remove that item.")
}

export const itemsTotal = (items: Item[]) => {
  const prices = items.map((i) => i.price_each).filter((p): p is number => p != null)
  return prices.length ? prices.reduce((a, b) => a + b, 0) : null
}

/** Pact Pilot reads the chat and each thing the group agreed on becomes an item. */
export async function addItemsWithGrok(id: string, messages: Message[], name: (id: string) => string) {
  let answer: Answer
  try { answer = await askPilotRaw(id, itemsQuestion, messages, name) }
  catch (e) { throw new Error(said(e, "Pact Pilot couldn't read the chat. Try again.")) }
  if (!answer.options?.length) throw new Error("Pact Pilot didn't find anything agreed in the chat yet. Add an item by hand, or agree on one in the chat first.")
  for (const o of answer.options) {
    await addItem(id, { kind: guessKind(`${o.title} ${o.description}`), title: o.title.slice(0, 120), location: '', startsOn: null, endsOn: null, link: o.link ?? '', price: o.price_per_person ?? null }, 'grok')
  }
}

/** Book it from the items: one write-up of everything, priced at the items' total each, for everyone to approve. */
export async function bookItems(id: string, pact: Pact, items: Item[], me: string) {
  const total = itemsTotal(items)
  if (total == null) throw new Error('Add a price to at least one item first.')
  const lines = items.map((i) => [`${itemTitle(i.kind)}: ${i.title}`, dateRange(i.starts_on, i.ends_on), i.price_each != null ? `${dollars(i.price_each)} each` : null].filter(Boolean).join(' · '))
  await saveRecommendation(id, {
    summary: `Everything you're booking: ${items.length} item${items.length === 1 ? '' : 's'}, ${dollars(total)} each.`,
    options: [{ title: pact.name, description: lines.join('\n'), tradeoff: '', price_per_person: total, link: items.find((i) => i.link)?.link ?? null }],
    tasks: [], costs: [], next_steps: ['Everyone approves', 'Everyone approves their share'],
  }).catch(() => { throw new Error("Couldn't put the items up for approval.") })
  const b = booking(await loadPactData(id, me))
  if (b) await createDecision(id, b.question, b.rec.recommendation_id)
}

// ---- Friends

export async function loadSocial() {
  const [r, f, i] = await Promise.all([
    supabase.rpc('list_friend_requests'), supabase.rpc('list_friends'), supabase.rpc('list_my_pact_invites'),
  ])
  return {
    requests: (r.data ?? []) as FriendRequest[],
    friends: ((f.data ?? []) as { user_id: string; name: string | null; avatar_url: string | null }[]).map((x) => ({ ...x, role: 'member' })) as Member[],
    invites: (i.data ?? []) as PactInvite[],
  }
}

export async function answerRequest(requestId: string, accept: boolean) {
  const { error } = await supabase.rpc('respond_friend_request', { p_request_id: requestId, p_accept: accept })
  if (error) throw new Error("Couldn't answer that request.")
}

export async function answerInvite(pactId: string, accept: boolean) {
  const { error } = await supabase.rpc('respond_pact_invite', { p_pact_id: pactId, p_accept: accept })
  if (error) throw new Error("Couldn't answer that invite.")
}

export async function searchPeople(q: string): Promise<PersonResult[]> {
  const { data, error } = await supabase.rpc('search_people', { p_query: q })
  if (error) throw new Error(/could not find the function|pgrst202/i.test(error.message) ? 'Search needs the latest database update.' : "Couldn't search right now.")
  return (data ?? []) as PersonResult[]
}

export async function requestFriend(userId: string) {
  const { error } = await supabase.rpc('send_friend_request_to', { p_user_id: userId })
  if (error) throw new Error("Couldn't send the request.")
}

// ---- Wallet

export async function loadWallet(): Promise<Wallet | null> {
  const r = await invoke<{ status: string; address?: string; usdc_balance?: string | null }>('wallet', { action: 'status' }).catch(() => null)
  return r?.status === 'ready' && r.address ? { address: r.address, usdcBalance: r.usdc_balance ?? null } : null
}

export async function makeWallet(): Promise<Wallet> {
  const w = await createPactMoneyWallet()
  return { address: w.address, usdcBalance: w.usdcBalance }
}

export async function loadActivity(): Promise<Transfer[]> {
  const { data } = await supabase.from('pact_transfers').select('transfer_id, sender_id, recipient_id, amount_usdc, status, created_at')
    .neq('status', 'awaiting_pin').order('created_at', { ascending: false }).limit(20)
  return (data ?? []) as Transfer[]
}

// ---- The full wallet ledger, read from the Arc explorer: every USDC in and out, and the network fees.

const EXPLORER = 'https://explorer.testnet.arc.io'
const USDC_TOKEN = '0x3600000000000000000000000000000000000000'
export const txLink = (hash: string) => `${EXPLORER}/tx/${hash}`

export type LedgerRow = {
  id: string
  at: string
  incoming: boolean
  amount: number
  /** Who it was with: a friend, a pact's PactSplit, test money, or an address nobody here knows. */
  kind: 'person' | 'share' | 'payout' | 'deposit' | 'address'
  userId: string | null
  address: string
  txHash: string
  /** For a share paid in or a payout, the pact it belongs to, read from the PactSplit call. */
  pactId: string | null
}
export type Ledger = { rows: LedgerRow[]; fees: number; total: number }

type ExplorerPage<T> = { items: T[]; next_page_params: Record<string, string | number> | null }
type TokenTransfer = {
  transaction_hash: string; log_index: number; timestamp: string
  from: { hash: string; is_contract?: boolean }; to: { hash: string; is_contract?: boolean }
  token: { address_hash?: string; address?: string }; total: { value: string; decimals: string }
}
type ExplorerTx = { hash: string; fee: { value: string }; from: { hash: string }; raw_input?: string }

async function explorerAll<T>(path: string, maxPages = 10): Promise<T[]> {
  const all: T[] = []
  let params: Record<string, string | number> | null = {}
  for (let page = 0; page < maxPages && params; page++) {
    const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
    const url = `${EXPLORER}/api/v2${path}${query ? `?${query}` : ''}`
    const res = await fetch(url).catch(() => null) ?? await new Promise((ok) => setTimeout(ok, 800)).then(() => fetch(url)).catch(() => null)
    if (!res?.ok) throw new Error('The Arc explorer could not be reached. Your balance is still right.')
    const body = await res.json() as ExplorerPage<T>
    all.push(...body.items)
    params = body.next_page_params
  }
  return all
}

/** Each pact member's wallet address, so a send to a friend shows their name and photo. */
async function memberWallets(pactIds: string[]) {
  const byAddress = new Map<string, string>()
  await Promise.all(pactIds.map(async (pactId) => {
    // One retry: the wallet function sometimes answers 502 while it starts up.
    const ask = () => invoke<{ members: { user_id: string; address: string }[] }>('wallet', { action: 'pact_member_wallets', pactId })
    const r = await ask().catch(() => new Promise((ok) => setTimeout(ok, 800)).then(ask)).catch(() => null)
    for (const m of r?.members ?? []) byAddress.set(m.address.toLowerCase(), m.user_id)
  }))
  return byAddress
}

function pactIdFromCall(input: string): string | null {
  const arg = input.replace(/^0x/, '').slice(8, 40).toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(arg)) return null
  return `${arg.slice(0, 8)}-${arg.slice(8, 12)}-${arg.slice(12, 16)}-${arg.slice(16, 20)}-${arg.slice(20)}`
}

export async function loadLedger(address: string, pactIds: string[]): Promise<Ledger> {
  const me = address.toLowerCase()
  const [transfers, txs, wallets] = await Promise.all([
    explorerAll<TokenTransfer>(`/addresses/${address}/token-transfers`),
    explorerAll<ExplorerTx>(`/addresses/${address}/transactions`),
    memberWallets(pactIds),
  ])
  const rows: LedgerRow[] = transfers
    .filter((t) => (t.token.address_hash ?? t.token.address ?? '').toLowerCase() === USDC_TOKEN)
    .map((t) => {
      const incoming = t.to.hash.toLowerCase() === me
      const other = incoming ? t.from : t.to
      const userId = wallets.get(other.hash.toLowerCase()) ?? null
      const kind: LedgerRow['kind'] = userId ? 'person'
        : other.is_contract ? (incoming ? 'payout' : 'share')
        : incoming ? 'deposit' : 'address'
      return {
        id: `${t.transaction_hash}:${t.log_index}`, at: t.timestamp, incoming,
        amount: Number(t.total.value) / 10 ** Number(t.total.decimals),
        kind, userId, address: other.hash, txHash: t.transaction_hash, pactId: null,
      }
    })
    .sort((a, b) => b.at.localeCompare(a.at))
  // PactSplit calls (payShare, release, claimRefund…) take the pact's id as their first argument: the pact's uuid
  // without dashes, padded to 32 bytes. Read it back so the row can name the pact and open it.
  const inputs = new Map(txs.map((t) => [t.hash, t.raw_input ?? '']))
  await Promise.all(rows.filter((r) => r.kind === 'share' || r.kind === 'payout').map(async (r) => {
    let input = inputs.get(r.txHash)
    if (!input) {
      const res = await fetch(`${EXPLORER}/api/v2/transactions/${r.txHash}`).catch(() => null)
      input = res?.ok ? ((await res.json()) as ExplorerTx).raw_input ?? '' : ''
    }
    r.pactId = pactIdFromCall(input)
  }))
  // Every transaction I send pays a small network fee in USDC.
  const fees = txs.filter((t) => t.from.hash.toLowerCase() === me).reduce((sum, t) => sum + Number(t.fee.value) / 1e18, 0)
  const total = rows.reduce((sum, r) => sum + (r.incoming ? r.amount : -r.amount), 0) - fees
  return { rows, fees, total }
}

// ---- Verification: QuickNode watches PactSplit on Arc and records each payment with its transaction.
// "verified" means QuickNode has confirmed every payment the chain shows (and the release, once released).
// "onchain" means the chain shows it but QuickNode hasn't confirmed all of it yet.

/** Who the pact is waiting on right now, and for what. Drives Pact Pilot's "Waiting on…" card and the Needs you list. */
export type Waiting = { what: 'approve' | 'start' | 'pay' | 'release'; people: string[]; amount: number | null }
export function waitingOn(d: PactData): Waiting | null {
  const host = coordinator(d)?.user_id ?? null
  const chain = d.chain
  // Same order as step(): what the chain says first, then the saved split, then the group's approval.
  if (chain && chain.state !== 'none') {
    if (chain.state !== 'open') return null
    if (chain.funded) return host ? { what: 'release', people: [host], amount: Number(chain.total.usdc) || null } : null
    const unpaid = chain.members.filter((m) => m.address && !m.paid && m.userId).map((m) => m.userId)
    return unpaid.length ? { what: 'pay', people: unpaid, amount: Number(chain.share.usdc) || null } : null
  }
  if (d.plan && !chain) return null // not read yet: don't guess
  if (d.plan) return host ? { what: 'start', people: [host], amount: null } : null
  const b = booking(d)
  const k = b && consent(d, b)
  if (!k || k.status === 'rejected') return null
  if (k.status === 'approved') return host ? { what: 'start', people: [host], amount: null } : null
  const people = d.members.map((m) => m.user_id).filter((u) => !k.votes?.[u])
  return people.length ? { what: 'approve', people, amount: null } : null
}

export type Check = { label: string; userId: string | null; onChain: boolean; quickNode: boolean; txHash: string | null }
export type Verification = { level: 'verified' | 'onchain' | 'none'; checks: Check[] }

export function verification(d: PactData): Verification {
  const chain = d.chain
  if (!chain || chain.state === 'none') return { level: 'none', checks: [] }
  const checks: Check[] = chain.members.filter((m) => m.address).map((m) => {
    const r = d.receipts.find((x) => x.user_id === m.userId)
    const name = m.userId ? d.members.find((x) => x.user_id === m.userId)?.name ?? 'Someone' : 'Someone'
    return { label: `${firstName(name)} paid`, userId: m.userId, onChain: m.paid, quickNode: Boolean(m.paid && r?.status === 'paid' && r.tx_hash), txHash: r?.tx_hash ?? null }
  }).filter((c) => c.onChain)
  if (chain.state === 'released' || chain.state === 'cancelled') {
    const ev = d.events.find((e) => e.event_type === chain.state)
    checks.push({ label: chain.state === 'released' ? 'Money released to the coordinator' : 'Pact cancelled', userId: null, onChain: true, quickNode: Boolean(ev), txHash: ev?.tx_hash ?? null })
  }
  if (!checks.length) return { level: 'none', checks }
  return { level: checks.every((c) => c.quickNode) ? 'verified' : 'onchain', checks }
}

// ---- PactTab: the live group tab. Log what you paid, say who it's for, and it works out who owes whom.
// The database does every sum in whole cents; this side only reads it and asks for changes.

export type TabMember = { user_id: string; name: string; is_you: boolean; paid_cents: number; share_cents: number; paid_back_cents: number; got_back_cents: number; balance_cents: number }
export type TabExpense = {
  expense_id: string; title: string; total_cents: number; spent_at: string; source: 'manual' | 'wallet' | 'plan' | 'grok'
  source_ref: string | null; created_by: string; version: number; payers: Record<string, number>; shares: Record<string, number>
}
export type TabPayback = { from: string; to: string; amount_cents: number }
export type Tab = { currency: string; members: TabMember[]; expenses: TabExpense[]; settle_up: TabPayback[] }

export const cents = (c: number) => `$${(Math.abs(c) / 100).toFixed(2)}`
export const toCents = (text: string) => Math.round(Number(text.replace(/[^0-9.]/g, '')) * 100)

export async function loadTab(id: string): Promise<Tab> {
  const { data, error } = await supabase.rpc('get_pact_tab', { p_pact_id: id })
  if (error) throw new Error(friendly(error, "Couldn't load the tab."))
  return data as Tab
}

export async function addExpense(id: string, e: { title: string; totalCents: number; paidBy?: string; splitWith?: string[]; txHash?: string }) {
  const { error } = await supabase.rpc('add_pact_expense', {
    p_pact_id: id, p_title: e.title.trim(), p_total_cents: e.totalCents, p_paid_by: e.paidBy ?? null,
    p_split_with: e.splitWith?.length ? e.splitWith : null, p_source: e.txHash ? 'wallet' : 'manual', p_source_ref: e.txHash ?? null,
  })
  if (error) throw new Error(said(error, "Couldn't add that."))
}

export async function joinExpense(expenseId: string) {
  const { error } = await supabase.rpc('join_pact_expense', { p_expense_id: expenseId })
  if (error) throw new Error(said(error, "Couldn't add you to that."))
}

export async function voidExpense(expenseId: string) {
  const { error } = await supabase.rpc('void_pact_expense', { p_expense_id: expenseId })
  if (error) throw new Error(said(error, "Couldn't remove that."))
}

/** I got paid back outside the wallet (cash, Venmo). Only the person who got the money can say so. */
export async function gotPaidBack(id: string, fromUser: string, amountCents: number) {
  const { error } = await supabase.rpc('record_pact_cash_payback', { p_pact_id: id, p_from_user: fromUser, p_amount_cents: amountCents })
  if (error) throw new Error(said(error, "Couldn't record that."))
}

/** Pay someone back in USDC. It's marked as a payback first, so once it confirms it counts on the tab. */
export async function payBack(id: string, toUser: string, amountCents: number) {
  const requestId = crypto.randomUUID()
  const { error } = await supabase.rpc('mark_pact_payback', { p_pact_id: id, p_request_id: requestId })
  if (error) throw new Error(said(error, "Couldn't start the payback."))
  await sendTo(id, toUser, amountCents, requestId)
}

/** Send USDC to someone in a pact by who they are (the server finds their wallet). A plain send stays off the tab. */
export async function sendTo(id: string, toUser: string, amountCents: number, requestId = crypto.randomUUID()) {
  const t = await sendPactMoney(id, toUser, (amountCents / 100).toFixed(2), requestId, () => undefined)
  if (t.status !== 'confirmed') throw new Error('The send has not confirmed yet. Check your wallet activity before sending again.')
}

/** Pact Pilot's answer read aloud by the ElevenLabs voice. Returns an audio clip to play. */
/** What you said in a recording, written out by ElevenLabs speech to text. */
export async function transcribe(clip: Blob): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim()
  if (!session || !url || !key) throw new Error('Sign in to talk to Pact Pilot.')
  const form = new FormData()
  form.append('audio', clip, clip.type.includes('mp4') ? 'speech.mp4' : 'speech.webm')
  const res = await fetch(`${url}/functions/v1/pilot-voice`, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, apikey: key }, body: form }).catch(() => null)
  const out = res ? await res.json().catch(() => null) as { text?: string; error?: string } | null : null
  if (!res?.ok || typeof out?.text !== 'string') throw new Error(out?.error && res?.status !== 400 ? out.error : "Couldn't hear that. Try again.")
  return out.text
}

export async function speak(text: string): Promise<Blob> {
  // Fetched directly, because functions.invoke reads an audio/mpeg reply as text and the clip comes back broken.
  const { data: { session } } = await supabase.auth.getSession()
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim()
  if (!session || !url || !key) throw new Error('Sign in to hear Pact Pilot.')
  const res = await fetch(`${url}/functions/v1/pilot-voice`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.slice(0, 1200) }),
  }).catch(() => null)
  const clip = res?.ok ? await res.blob() : null
  if (!clip || !clip.size) throw new Error("Pact Pilot's voice isn't available right now.")
  return clip.type ? clip : new Blob([clip], { type: 'audio/mpeg' })
}

export type PilotAction = { tool: string; args: Record<string, unknown> }
/** Pact Pilot's reply, and the changes it wants to make. operationId is the saved plan the asker approves. */
export type PilotAnswer = { reply: string; actions: PilotAction[]; operationId: string | null; poll?: { title: string; options: { name: string; price_each: number | null }[] } | null }

/** Ask Pact Pilot anything about the pact. It reads the tab and the plan, and proposes changes that only run once you approve. */
export async function askGrok(id: string, question: string): Promise<PilotAnswer> {
  const a = await invoke<{ reply?: string; summary?: string; actions?: PilotAction[]; operation_id?: string | null; poll?: PilotAnswer['poll'] }>('pactpilot', { pact_id: id, question: question.slice(0, 2000), quick: question === summaryQuestion, idempotency_key: crypto.randomUUID() })
  return { reply: a.reply ?? a.summary ?? '', actions: a.actions ?? [], operationId: a.operation_id ?? null, poll: a.poll ?? null }
}

/** Your saved Pact Pilot conversation in this pact, oldest first. Empty if the history table isn't live yet. */
export type PilotTurn = { id: string; question: string; answer: PilotAnswer; at: string }
export async function loadPilotHistory(id: string): Promise<PilotTurn[]> {
  const { data, error } = await supabase.from('pact_pilot_messages')
    .select('message_id, question, reply, created_at')
    .eq('pact_id', id).order('created_at', { ascending: false }).limit(40)
  if (error || !data) return []
  return data.reverse().map((r) => ({
    id: r.message_id as string, question: r.question as string, at: r.created_at as string,
    answer: { reply: r.reply as string, actions: [], operationId: null }, // past proposals were approved or dropped then
  }))
}

/** Clear your own Pact Pilot conversation in this pact. */
export async function clearPilotHistory(id: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const { error } = await supabase.from('pact_pilot_messages').delete().eq('pact_id', id).eq('user_id', user.id)
  if (error) throw new Error("Couldn't clear the conversation.")
}

/** Run the plan the asker approved, one change at a time, and record how it went. It runs once: a second tap fails in the database. */
export async function approveGrok(id: string, operationId: string) {
  const { data: plan, error } = await supabase.rpc('begin_pact_ai_operation', { p_operation_id: operationId })
  if (error) throw new Error(said(error, 'That plan was already approved or has expired. Ask Pact Pilot again.'))
  const actions = ((plan as { actions?: PilotAction[] } | null)?.actions ?? [])
  const results: unknown[] = []
  try {
    for (const a of actions) results.push(await invoke('pactpilot', { pact_id: id, tool: a.tool, args: a.args }))
  } catch (e) {
    await supabase.rpc('finish_pact_ai_operation', { p_operation_id: operationId, p_status: 'failed', p_result: { results, error: (e as Error).message } })
    throw new Error(said(e, "Pact Pilot's change didn't go through."))
  }
  await supabase.rpc('finish_pact_ai_operation', { p_operation_id: operationId, p_status: 'completed', p_result: { results } })
}

/** Wallet payments already on a tab, by transaction hash, so the wallet can show which pact each went to. */
export async function loadTaggedPayments(): Promise<Map<string, string>> {
  const { data } = await supabase.from('pact_expenses').select('pact_id, source_ref').eq('source', 'wallet').eq('status', 'active')
  return new Map((data ?? []).map((r) => [String(r.source_ref).toLowerCase(), r.pact_id as string]))
}
