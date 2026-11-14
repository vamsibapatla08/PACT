export type PactPilotPlan = {
  summary?: string | null
  suggestedTasks: string[]
  estimatedCost?: string | null
  nextSteps: string[]
}

export type PactPilotMessage = {
  id: string
  role: 'user' | 'assistant'
  body: string
  created_at: string
  plan?: PactPilotPlan | null
}

export type PactPilotContext = { pactId: string; pactName: string }

