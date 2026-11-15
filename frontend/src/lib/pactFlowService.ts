import { supabase } from './supabase'
import type { PactDecision, PactMilestone, PactRecommendation } from '../types/pactFlow'

function client() { if (!supabase) throw new Error('Pact is not connected to Supabase yet.'); return supabase }

export async function loadPactFlow(pactId: string) {
  const c = client()
  const [milestones, recommendations, decisions, counts] = await Promise.all([
    c.from('pact_milestones').select('*').eq('pact_id', pactId).order('position'),
    c.from('pact_recommendations').select('*').eq('pact_id', pactId).order('created_at', { ascending: false }),
    c.from('pact_decisions').select('*').eq('pact_id', pactId).order('created_at', { ascending: false }),
    c.rpc('get_pact_decision_counts', { p_pact_id: pactId }),
  ])
  const failure = [milestones, recommendations, decisions, counts].find((result) => result.error)
  if (failure?.error) throw failure.error
  const countMap = new Map((counts.data ?? []).map((item: { decision_id: string; approve_count: number; reject_count: number; eligible_count: number }) => [item.decision_id, item]))
  return { milestones: (milestones.data ?? []) as PactMilestone[], recommendations: (recommendations.data ?? []) as PactRecommendation[], decisions: (decisions.data ?? []).map((item) => ({ ...item, ...(countMap.get(item.decision_id) ?? {}) })) as PactDecision[] }
}

export async function seedPactMilestones(pactId: string, pactType = 'general') { const { error } = await client().rpc('seed_pact_milestones', { p_pact_id: pactId, p_pact_type: pactType }); if (error) throw error }
export async function savePactRecommendation(pactId: string, recommendation: { summary: string; options?: unknown[]; tasks?: unknown[]; costs?: unknown[]; next_steps?: string[] }) { const { data, error } = await client().rpc('save_pact_recommendation', { p_pact_id: pactId, p_summary: recommendation.summary, p_options: recommendation.options ?? [], p_tasks: recommendation.tasks ?? [], p_costs: recommendation.costs ?? [], p_next_steps: recommendation.next_steps ?? [] }); if (error) throw error; return data as string }
export async function castPactDecisionVote(decisionId: string, vote: 'approve' | 'reject') { const { data, error } = await client().rpc('cast_pact_decision_vote', { p_decision_id: decisionId, p_vote: vote }); if (error) throw error; return data as PactDecision }
export async function createPactDecision(pactId: string, question: string, options: string[], approvalRule: PactDecision['approval_rule'], recommendationId?: string) { const { data, error } = await client().rpc('create_pact_decision', { p_pact_id: pactId, p_question: question, p_options: options, p_approval_rule: approvalRule, p_recommendation_id: recommendationId ?? null }); if (error) throw error; return data as string }
