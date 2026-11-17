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
  | { kind: 'startCollecting' } | { kind: 'waitStart'; host: string }
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
export const summaryQuestion = "Sum up what our group has agreed so far and what is still missing. Don't suggest places."

export function friendly(error: unknown, fallback: string) {
  const text = String((error as { message?: string })?.message ?? error).toLowerCase()
  if (text.includes('row-level security') || text.includes('permission denied') || text.includes('42501')) return "You don't have permission to do that."
  if (text.includes('failed to fetch') || text.includes('network')) return "Pact can't reach the server. Check your connection."
  return fallback
}

/** Calls an Edge Function as me. A 4xx comes back as its readable `error`. */
async function invoke<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body })
  if (error) {
    const response = (error as { context?: unknown }).context
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
    ? (await supabase.from('pact_decision_votes').select('decision_id, vote').eq('user_id', me).in('decision_id', decisions.map((d) => d.decision_id))).data ?? []
    : []
  for (const d of decisions) {
    const c = (counts ?? []).find((x: { decision_id: string }) => x.decision_id === d.decision_id)
    d.approvals = c?.approve_count ?? 0; d.rejects = c?.reject_count ?? 0; d.eligible = c?.eligible_count ?? 0
    d.myVote = votes.find((v) => v.decision_id === d.decision_id)?.vote ?? null
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
  const chain = await invoke<Chain>('wallet', { action: 'pact_status', pactId: id }).catch(() => null)
  return { plan, chain, receipts, events: (events ?? []) as PaymentEvent[] }
}

export async function loadItems(id: string): Promise<Item[]> {
  const { data } = await supabase.from('pact_items').select('item_id, kind, title, location, starts_on, ends_on, link, price_each, source, created_by')
    .eq('pact_id', id).order('starts_on', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true })
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
  const rec = d.recommendations[0]
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
    case 'talk': return { text: hasGrok ? 'Planning' : 'Set up with Grok', action: !hasGrok }
    case 'declined': return { text: 'Set up with Grok again', action: true }
    case 'approve': return { text: 'Approve', action: true }
    case 'needsWallet': return { text: 'Set my PIN to collect', action: true }
    case 'startCollecting': return { text: 'Start collecting', action: true }
    case 'pay': return { text: `Approve ${dollars(s.amount)}`, action: true }
    case 'finalise': return { text: `Finalise and book · ${dollars(s.total)}`, action: true }
    case 'waitingApprovals': return { text: `You approved · ${s.approved} of ${s.of}`, action: false }
    case 'settingUp': return { text: 'Setting up the split', action: false }
    case 'waitSetup': return { text: `Waiting for ${s.host} to set up the split`, action: false }
    case 'waitStart': return { text: `Waiting for ${s.host} to start collecting`, action: false }
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

// ---- Chat and Grok

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

/** Called while Grok is on its second try, so the page can say so. */
export let onGrokRetry: (() => void) | null = null
export const setGrokRetryListener = (f: (() => void) | null) => { onGrokRetry = f }

async function askPilotRaw(id: string, question: string, messages: Message[], name: (id: string) => string) {
  const ask = () => invoke<Answer>('pactpilot', { pact_id: id, question: withChat(question, messages, name) })
  try { return await ask() }
  catch (e) {
    // Grok sometimes runs past the function's time limit. One more try usually lands.
    if (!/timed out|request failed \(5\d\d\)|non-2xx|50[234]/i.test(String((e as Error).message))) throw e
    onGrokRetry?.()
    try { return await ask() }
    catch { throw new Error('Grok is slow right now and timed out twice. Try again in a minute.') }
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

/** Grok reads the chat, writes up the one thing to book, and it goes to everyone to approve. */
export async function askGrokToBook(id: string, me: string, pact: Pact, messages: Message[], name: (id: string) => string) {
  await askPilot(id, bookingQuestion, messages, name)
  const d = await loadPactData(id, me)
  const b = booking(d)
  if (!b) throw new Error("Grok couldn't find one thing you've agreed to book yet. Agree on it in the chat, with the link and price, then try again.")
  if (consent(d, b)) return
  await createDecision(id, b.question, b.rec.recommendation_id)
  await importFromGrok(pact, d, me)
}

/** Grok's write-up fills in the link and price when the coordinator hasn't set them yet. */
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
  if (!b || b.perPerson == null) throw new Error("Grok's card has no price yet. Ask Grok again with the price in the chat.")
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

export async function addItem(id: string, d: ItemDraft, source: 'manual' | 'grok' = 'manual') {
  const { error } = await supabase.from('pact_items').insert({
    pact_id: id, kind: d.kind, title: d.title.trim(), location: d.location.trim() || null,
    starts_on: d.startsOn, ends_on: d.startsOn ? (d.endsOn && d.endsOn >= d.startsOn ? d.endsOn : d.startsOn) : null,
    link: withScheme(d.link) || null, price_each: d.price, source,
  })
  if (error) throw new Error(/row-level security/i.test(error.message) ? 'Items are locked once the split is set up.' : "Couldn't add that item.")
}

export async function removeItem(itemId: string) {
  const { error } = await supabase.from('pact_items').delete().eq('item_id', itemId)
  if (error) throw new Error("Couldn't remove that item.")
}

export const itemsTotal = (items: Item[]) => {
  const prices = items.map((i) => i.price_each).filter((p): p is number => p != null)
  return prices.length ? prices.reduce((a, b) => a + b, 0) : null
}

/** Grok reads the chat and each thing the group agreed on becomes an item. */
export async function addItemsWithGrok(id: string, messages: Message[], name: (id: string) => string) {
  let answer: Answer
  try { answer = await askPilotRaw(id, itemsQuestion, messages, name) }
  catch (e) { throw new Error(said(e, "Grok couldn't read the chat. Try again.")) }
  if (!answer.options?.length) throw new Error("Grok didn't find anything agreed in the chat yet. Add an item by hand, or agree on one in the chat first.")
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
export type TabAction = { tool: string; args: Record<string, unknown> }
export type TabAnswer = { reply: string; actions: TabAction[] }

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

/** Pay someone back in USDC. A confirmed send counts on the tab by itself. */
export async function payBack(id: string, toUser: string, amountCents: number) {
  const t = await sendPactMoney(id, toUser, (amountCents / 100).toFixed(2), crypto.randomUUID(), () => undefined)
  if (t.status !== 'confirmed') throw new Error('The payback has not confirmed yet. Check your wallet activity.')
}

const tabTools = ['add_expense', 'join_expense', 'resplit_expense', 'import_plan_to_tab']

/** Ask Grok about money. It reads the tab and may propose changes, which only run when you tap them. */
export async function askGrokAboutTab(id: string, question: string): Promise<TabAnswer> {
  const a = await invoke<{ reply?: string; summary?: string; actions?: TabAction[] }>('pactpilot', { pact_id: id, question: question.slice(0, 2000) })
  return { reply: a.reply ?? a.summary ?? '', actions: (a.actions ?? []).filter((x) => tabTools.includes(x.tool)) }
}

export async function runTabAction(id: string, action: TabAction) {
  try { await invoke('pactpilot', { pact_id: id, tool: action.tool, args: action.args }) }
  catch (e) { throw new Error(said(e, "Grok's change didn't go through.")) }
}

/** Wallet payments already on a tab, by transaction hash, so the wallet can show which pact each went to. */
export async function loadTaggedPayments(): Promise<Map<string, string>> {
  const { data } = await supabase.from('pact_expenses').select('pact_id, source_ref').eq('source', 'wallet').eq('status', 'active')
  return new Map((data ?? []).map((r) => [String(r.source_ref).toLowerCase(), r.pact_id as string]))
}
