import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { PactChatMessage } from '../types/chat'

type MessageRow = { message_id: string; pact_id: string; sender_id: string; body: string; created_at: string }

function client() {
  if (!supabase) throw new Error('Pact is not connected to Supabase yet.')
  return supabase
}

function toMessage(row: MessageRow): PactChatMessage {
  return { id: row.message_id, pact_id: row.pact_id, sender_id: row.sender_id, sender_name: null, sender_avatar_url: null, body: row.body, created_at: row.created_at }
}

export async function listPactMessages(pactId: string): Promise<PactChatMessage[]> {
  const { data, error } = await client()
    .from('pact_messages')
    .select('message_id, pact_id, sender_id, body, created_at')
    .eq('pact_id', pactId)
    .order('created_at', { ascending: true })
    .order('message_id', { ascending: true })
  if (error) throw error
  return (data ?? []).map((row) => toMessage(row as MessageRow))
}

export async function sendPactMessage(pactId: string, body: string): Promise<void> {
  const { error } = await client().from('pact_messages').insert({ pact_id: pactId, body: body.trim() })
  if (error) throw error
}

export function subscribeToPactMessages(pactId: string, onMessage: (message: PactChatMessage) => void, onStatus: (status: string) => void): () => void {
  const channel: RealtimeChannel = client()
    .channel(`pact-messages:${pactId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pact_messages', filter: `pact_id=eq.${pactId}` }, (payload) => onMessage(toMessage(payload.new as MessageRow)))
    .subscribe((status) => onStatus(status))
  return () => { void client().removeChannel(channel) }
}

