import { supabase } from './supabase'
import type { PactPilotAgreement, PactPilotContext, PactPilotCost, PactPilotFitIssue, PactPilotEstimate, PactPilotMessage, PactPilotOption, PactPilotTask } from '../types/pactPilot'

export type PactPilotProposedAction = { tool: PactPilotToolName; args: Record<string, unknown>; requires_confirmation: true }
type PactPilotResponse = { summary: string; agreement?: PactPilotAgreement; fit_issues?: PactPilotFitIssue[]; options: PactPilotOption[]; tasks?: PactPilotTask[]; costs?: PactPilotCost[]; estimate?: PactPilotEstimate; next_steps?: string[]; actions?: PactPilotProposedAction[]; operation_id?: string }
export type PactPilotAskRequest = { context: PactPilotContext; prompt: string }

function client() {
  if (!supabase) throw new Error('Pact is not connected to Supabase yet.')
  return supabase
}

async function functionError(error: { message?: string; context?: unknown } | null) {
  const context = error?.context
  const status = context instanceof Response ? context.status : typeof context === 'object' && context !== null && 'status' in context && typeof context.status === 'number' ? context.status : undefined
  if (status === 401) return 'Please sign in again before using PactPilot.'
  if (status === 403) return 'You must be an active member of this Pact to use PactPilot.'
  if (context instanceof Response) {
    const payload = await context.clone().json().catch(() => null) as { error?: unknown; message?: unknown } | null
    const detail = typeof payload?.error === 'string' ? payload.error : typeof payload?.message === 'string' ? payload.message : null
    if (detail) return `PactPilot request failed (${status ?? 'unknown'}): ${detail}`
  }
  return error?.message || 'PactPilot could not process that request.'
}

export type PactPilotDataSource = { ask: (request: PactPilotAskRequest) => Promise<PactPilotMessage> }

export type PactPilotToolName = 'read_pact_state' | 'read_booking_options' | 'read_booking_state' | 'prepare_booking_proposal' | 'read_split_state' | 'prepare_split' | 'read_rebalance' | 'prepare_rebalance' | 'vote_rebalance' | 'apply_rebalance' | 'create_poll' | 'publish_action_card' | 'enqueue_email'
export type PactPilotToolResult = { kind: 'tool_result'; tool: PactPilotToolName; status: string; [key: string]: unknown }

const activeOperationIds = new Set<string>()

export async function askPactPilot({ context, prompt }: PactPilotAskRequest): Promise<PactPilotMessage> {
  const { data, error } = await client().functions.invoke('pactpilot', { body: { pact_id: context.pactId, question: prompt.trim() } })
  if (error) throw new Error(await functionError(error))
  const response = data as PactPilotResponse | null
  if (!response || typeof response.summary !== 'string' || !Array.isArray(response.options)) throw new Error('PactPilot returned an unexpected response.')
  const options = response.options.filter((option: unknown): option is PactPilotOption => {
    if (!option || typeof option !== 'object') return false
    const candidate = option as Record<string, unknown>
    return typeof candidate.title === 'string' && typeof candidate.description === 'string' && typeof candidate.tradeoff === 'string'
  })
  if (options.length !== response.options.length) throw new Error('PactPilot returned an invalid option.')
  const tasks = Array.isArray(response.tasks) ? response.tasks.filter((task) => typeof task?.title === 'string') : undefined
  const costs = Array.isArray(response.costs) ? response.costs.filter((cost) => typeof cost?.item === 'string' && typeof cost.estimated_amount === 'number' && (cost.option_title == null || typeof cost.option_title === 'string') && (cost.is_shared == null || typeof cost.is_shared === 'boolean')) : undefined
  const estimate = response.estimate && (typeof response.estimate.total === 'number' || response.estimate.total === null) ? response.estimate : undefined
  const agreement = response.agreement && typeof response.agreement.agreed === 'boolean' ? response.agreement : undefined
  const fit_issues = Array.isArray(response.fit_issues) ? response.fit_issues.filter((issue) => typeof issue?.problem === 'string' && typeof issue.suggestion === 'string') : undefined
  const next_steps = Array.isArray(response.next_steps) ? response.next_steps.filter((step) => typeof step === 'string') : undefined
  const actions = Array.isArray(response.actions) ? response.actions.filter((action): action is PactPilotProposedAction => Boolean(action) && typeof action.tool === 'string' && action.args !== null && typeof action.args === 'object' && action.requires_confirmation === true) : []
  return { id: `pilot-${Date.now()}`, role: 'assistant', body: '', summary: response.summary, agreement, fit_issues, options, tasks, costs, estimate, next_steps, actions, operation_id: typeof response.operation_id === 'string' ? response.operation_id : undefined, created_at: new Date().toISOString() }
}

export async function runPactPilotTool(context: PactPilotContext, tool: PactPilotToolName, args: Record<string, unknown>): Promise<PactPilotToolResult> {
  const { data, error } = await client().functions.invoke('pactpilot', { body: { pact_id: context.pactId, question: `Execute approved tool: ${tool}`, tool, args } })
  if (error) throw new Error(await functionError(error))
  if (!data || data.kind !== 'tool_result' || data.tool !== tool || typeof data.status !== 'string') throw new Error('PactPilot returned an unexpected tool result.')
  return data as PactPilotToolResult
}

export async function executePactPilotOperation(context: PactPilotContext, operationId: string): Promise<Record<string, unknown>> {
  if (activeOperationIds.has(operationId)) throw new Error('This PactPilot operation is already being confirmed.')
  activeOperationIds.add(operationId)
  const c = client()
  try {
    const { data: plan, error: beginError } = await c.rpc('begin_pact_ai_operation', { p_operation_id: operationId })
    if (beginError) throw beginError
    const actions = Array.isArray((plan as { actions?: unknown })?.actions) ? (plan as { actions: Array<{ tool: PactPilotToolName; args: Record<string, unknown> }> }).actions : []
    const results: PactPilotToolResult[] = []
    try {
      for (const action of actions) results.push(await runPactPilotTool(context, action.tool, action.args))
      const { data, error } = await c.rpc('finish_pact_ai_operation', { p_operation_id: operationId, p_status: 'completed', p_result: { results } })
      if (error) throw error
      return (data as { result?: Record<string, unknown> })?.result ?? { results }
    } catch (reason) {
      try { await c.rpc('finish_pact_ai_operation', { p_operation_id: operationId, p_status: 'failed', p_result: { error: reason instanceof Error ? reason.message : 'Tool execution failed' } }) } catch { /* preserve the original tool error */ }
      throw reason
    }
  } finally {
    activeOperationIds.delete(operationId)
  }
}

