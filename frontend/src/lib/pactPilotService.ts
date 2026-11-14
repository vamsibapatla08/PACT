import type { PactPilotContext, PactPilotMessage } from '../types/pactPilot'

export type PactPilotAskRequest = { context: PactPilotContext; prompt: string }
export type PactPilotDataSource = { ask: (request: PactPilotAskRequest) => Promise<PactPilotMessage> }

// Intentionally unimplemented until the server-side Grok contract is confirmed.
export async function askPactPilot(_request: PactPilotAskRequest): Promise<PactPilotMessage> {
  throw new Error('PactPilot backend integration is not connected yet.')
}

