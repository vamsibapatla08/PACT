export type PactPilotOption = { title: string; description: string; tradeoff: string; price_per_person?: number | null; link?: string | null }
export type PactPilotAgreement = { agreed: boolean; place: string | null; dates: string | null; people: number | null; budget_per_person: number | null; missing: string[] }
export type PactPilotFitIssue = { problem: string; suggestion: string }
export type PactPilotTask = { title: string; owner_suggestion: string | null; due_hint: string }
export type PactPilotCost = { item: string; estimated_amount: number; currency: string; per_person_amount: number | null; option_title?: string | null; is_shared?: boolean; is_estimate: true }
export type PactPilotAlternativeEstimate = { option_title: string; total: number; per_person: number | null }
export type PactPilotEstimate = { currency: string; group_size: number | null; mode?: 'combined' | 'alternatives'; total: number | null; per_person: number | null; alternatives?: PactPilotAlternativeEstimate[]; budget: number | null; within_budget: boolean | null; difference: number | null; label: string }

export type PactPilotMessage = {
  id: string
  role: 'user' | 'assistant'
  body: string
  created_at: string
  summary?: string
  agreement?: PactPilotAgreement
  fit_issues?: PactPilotFitIssue[]
  options?: PactPilotOption[]
  tasks?: PactPilotTask[]
  costs?: PactPilotCost[]
  estimate?: PactPilotEstimate
  next_steps?: string[]
  actions?: Array<{ tool: string; args: Record<string, unknown>; requires_confirmation: true }>
  operation_id?: string
}

export type PactPilotContext = { pactId: string; pactName: string }

