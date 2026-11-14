export type PactPilotOption = { title: string; description: string; tradeoff: string }

export type PactPilotMessage = {
  id: string
  role: 'user' | 'assistant'
  body: string
  created_at: string
  summary?: string
  options?: PactPilotOption[]
}

export type PactPilotContext = { pactId: string; pactName: string }

