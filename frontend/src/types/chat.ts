export type PactChatMessage = {
  id: string
  pact_id: string
  sender_id: string
  sender_name: string | null
  sender_avatar_url: string | null
  body: string
  created_at: string
  action_card_id?: string | null
}

/** Backend-neutral boundary for Vamsi's confirmed chat implementation. */
export type PactChatDataSource = {
  listMessages: (pactId: string) => Promise<PactChatMessage[]>
  sendMessage: (pactId: string, body: string) => Promise<PactChatMessage>
  subscribe: (pactId: string, onMessage: (message: PactChatMessage) => void) => () => void
}
