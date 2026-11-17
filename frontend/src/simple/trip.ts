import { supabase } from '../lib/supabase'
import { getPactWorkspace } from '../lib/pactService'
import { listPactMessages } from '../lib/chatService'
import { loadPactFlow } from '../lib/pactFlowService'
import { getPactPaymentStatus } from '../lib/pactMoneyService'
import type { PactWorkspace } from '../types/pact'
import type { PactChatMessage } from '../types/chat'
import type { PactDecision, PactRecommendation } from '../types/pactFlow'
import type { PactPilotOption } from '../types/pactPilot'
import type { PactPaymentStatus, PactPaymentStatusRow } from '../types/pactMoney'

export type Vote = 'approve' | 'reject'
export type TripDecision = PactDecision & { myVote: Vote | null }
export type Share = { userId: string; paid: boolean; refunded: boolean; txHash: string | null }
export type Payment = { status: PactPaymentStatus; share: number; needed: number; deadline: string; payee: string; shares: Share[] }

export type Trip = {
  pact: PactWorkspace
  me: string
  isHost: boolean
  messages: PactChatMessage[]
  recommendations: PactRecommendation[]
  decisions: TripDecision[]
  payment: Payment | null
}

export type Stage = 'plan' | 'vote' | 'pay' | 'booked'
export const stages: Stage[] = ['plan', 'vote', 'pay', 'booked']

export type NextStep =
  | { kind: 'ask' }
  | { kind: 'pick' }
  | { kind: 'vote'; decision: TripDecision }
  | { kind: 'set-share'; price: number | null }
  | { kind: 'open-pot' }
  | { kind: 'pay'; amount: number }
  | { kind: 'release'; total: number }
  | { kind: 'wait'; text: string }
  | { kind: 'done'; text: string }

export function memberName(trip: Trip, userId: string) {
  if (userId === trip.me) return 'You'
  return trip.pact.members.find((m) => m.user_id === userId)?.profile?.full_name?.split(' ')[0] || 'A friend'
}

export function optionsOf(rec: PactRecommendation): PactPilotOption[] {
  return (rec.options as PactPilotOption[]).filter((o) => o && typeof o.title === 'string')
}

// A vote on a stay is saved as "Book <title>?" and linked to the Grok answer that offered it.
export const voteQuestion = (option: PactPilotOption) => `Book ${option.title}?`

export function pickedOption(trip: Trip, decision: PactDecision): PactPilotOption | null {
  const rec = trip.recommendations.find((r) => r.recommendation_id === decision.recommendation_id)
  return rec ? optionsOf(rec).find((o) => voteQuestion(o) === decision.question) ?? null : null
}

export const approvedDecision = (trip: Trip) => trip.decisions.find((d) => d.status === 'approved') ?? null

export function stageOf(trip: Trip): Stage {
  if (trip.payment?.status === 'released') return 'booked'
  if (trip.payment) return 'pay'
  if (approvedDecision(trip)) return 'pay'
  if (trip.recommendations.length) return 'vote'
  return 'plan'
}

export function nextStep(trip: Trip): NextStep {
  const host = memberName(trip, trip.pact.members.find((m) => m.role === 'host')?.user_id ?? '')
  const p = trip.payment
  if (p) {
    const paid = p.shares.filter((s) => s.paid).length
    if (p.status === 'released') return { kind: 'done', text: `Everyone paid. $${money(p.share * p.needed)} went to ${host === 'You' ? 'you' : host}.` }
    if (p.status === 'cancelled') return { kind: 'done', text: 'This trip was cancelled. Everyone can claim their share back.' }
    if (p.status === 'none') return trip.isHost ? { kind: 'open-pot' } : { kind: 'wait', text: `Waiting for ${host} to open the pot.` }
    const mine = p.shares.find((s) => s.userId === trip.me)
    if (mine && !mine.paid) return { kind: 'pay', amount: p.share }
    if (paid >= p.needed) return trip.isHost ? { kind: 'release', total: p.share * p.needed } : { kind: 'wait', text: `Everyone's paid. Waiting for ${host} to book it.` }
    const left = p.needed - paid
    return { kind: 'wait', text: `You're paid. Waiting on ${left} more ${left === 1 ? 'friend' : 'friends'}.` }
  }
  const approved = approvedDecision(trip)
  if (approved) return trip.isHost
    ? { kind: 'set-share', price: pickedOption(trip, approved)?.price_per_person ?? null }
    : { kind: 'wait', text: `The group picked it. Waiting for ${host} to set everyone's share.` }
  const open = trip.decisions.find((d) => d.status === 'open')
  if (open && !open.myVote) return { kind: 'vote', decision: open }
  if (open) {
    const left = (open.eligible_count ?? 0) - (open.approve_count ?? 0) - (open.reject_count ?? 0)
    return { kind: 'wait', text: `You voted. Waiting on ${left} more ${left === 1 ? 'vote' : 'votes'}.` }
  }
  if (trip.recommendations.length) return { kind: 'pick' }
  return { kind: 'ask' }
}

export const money = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2))

function toPayment(rows: PactPaymentStatusRow[]): Payment | null {
  const first = rows[0]
  if (!first) return null
  return {
    status: first.payment_status,
    share: Number(first.share_usdc),
    needed: first.shares_needed,
    deadline: first.deadline,
    payee: first.payee_address,
    shares: rows.filter((r) => r.user_id).map((r) => ({ userId: r.user_id!, paid: r.share_status === 'paid', refunded: r.share_status === 'refunded', txHash: r.tx_hash })),
  }
}

export async function loadTrip(pactId: string, me: string): Promise<Trip> {
  const [pact, messages, flow, payment] = await Promise.all([
    getPactWorkspace(pactId),
    listPactMessages(pactId),
    loadPactFlow(pactId),
    getPactPaymentStatus(pactId).then(toPayment).catch(() => null),
  ])
  const ids = flow.decisions.map((d) => d.decision_id)
  const votes = ids.length && supabase
    ? (await supabase.from('pact_decision_votes').select('decision_id, vote').eq('user_id', me).in('decision_id', ids)).data ?? []
    : []
  const myVotes = new Map(votes.map((v) => [v.decision_id as string, v.vote as Vote]))
  return {
    pact,
    me,
    isHost: pact.members.some((m) => m.user_id === me && m.role === 'host'),
    messages,
    recommendations: flow.recommendations,
    decisions: flow.decisions.map((d) => ({ ...d, myVote: myVotes.get(d.decision_id) ?? null })),
    payment,
  }
}
