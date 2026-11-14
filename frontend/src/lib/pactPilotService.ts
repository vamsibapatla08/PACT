import { supabase } from './supabase'
import type { PactPilotContext, PactPilotMessage, PactPilotOption } from '../types/pactPilot'

type PactPilotResponse = { summary: string; options: PactPilotOption[] }
export type PactPilotAskRequest = { context: PactPilotContext; prompt: string }

function client() {
  if (!supabase) throw new Error('Pact is not connected to Supabase yet.')
  return supabase
}

function functionError(error: { message?: string; context?: { status?: number } } | null) {
  const status = error?.context?.status
  if (status === 401) return 'Please sign in again before using PactPilot.'
  if (status === 403) return 'You must be an active member of this Pact to use PactPilot.'
  return error?.message || 'PactPilot could not process that request.'
}

export type PactPilotDataSource = { ask: (request: PactPilotAskRequest) => Promise<PactPilotMessage> }

export async function askPactPilot({ context, prompt }: PactPilotAskRequest): Promise<PactPilotMessage> {
  const { data, error } = await client().functions.invoke('pactpilot', { body: { pact_id: context.pactId, question: prompt.trim() } })
  if (error) throw new Error(functionError(error))
  const response = data as PactPilotResponse | null
  if (!response || typeof response.summary !== 'string' || !Array.isArray(response.options)) throw new Error('PactPilot returned an unexpected response.')
  const options = response.options.filter((option: unknown): option is PactPilotOption => {
    if (!option || typeof option !== 'object') return false
    const candidate = option as Record<string, unknown>
    return typeof candidate.title === 'string' && typeof candidate.description === 'string' && typeof candidate.tradeoff === 'string'
  })
  if (options.length !== response.options.length) throw new Error('PactPilot returned an invalid option.')
  return { id: `pilot-${Date.now()}`, role: 'assistant', body: '', summary: response.summary, options, created_at: new Date().toISOString() }
}

