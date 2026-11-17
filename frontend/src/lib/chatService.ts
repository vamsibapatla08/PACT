import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { PactChatMessage } from '../types/chat'

type MessageRow = { message_id: string; pact_id: string; sender_id: string; body: string; created_at: string; action_card_id?: string | null }

function client() {
  if (!supabase) throw new Error('Pact is not connected to Supabase yet.')
  return supabase
}

function toMessage(row: MessageRow): PactChatMessage {
  return { id: row.message_id, pact_id: row.pact_id, sender_id: row.sender_id, sender_name: null, sender_avatar_url: null, body: row.body, created_at: row.created_at, action_card_id: row.action_card_id ?? null }
}

export async function listPactMessages(pactId: string): Promise<PactChatMessage[]> {
  const { data, error } = await client()
    .from('pact_messages')
    .select('message_id, pact_id, sender_id, body, created_at, action_card_id')
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

export async function sharePactActionCard(cardId: string): Promise<string> {
  const { data, error } = await client().rpc('share_pact_action_card', { p_card_id: cardId })
  if (error) throw error
  return data as string
}

export type PactActionCardRecord = { card_id: string; pact_id: string; action_type: string; state: string; title: string; description: string; payload: Record<string, unknown> }

export async function listPactActionCards(pactId: string): Promise<PactActionCardRecord[]> {
  const { data, error } = await client().from('pact_action_cards').select('card_id,pact_id,action_type,state,title,description,payload').eq('pact_id', pactId).order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as PactActionCardRecord[]
}

export function subscribeToPactActionCards(pactId: string, onCard: (card: PactActionCardRecord) => void, onStatus?: (status: string) => void): () => void {
  const channel: RealtimeChannel = client().channel(`pact-action-cards:${pactId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'pact_action_cards', filter: `pact_id=eq.${pactId}` }, (payload) => {
    if (payload.eventType !== 'DELETE') onCard(payload.new as PactActionCardRecord)
  }).subscribe((status) => onStatus?.(status))
  return () => { void client().removeChannel(channel) }
}

export function subscribeToPactMessages(pactId: string, onMessage: (message: PactChatMessage) => void, onStatus: (status: string) => void): () => void {
  const channel: RealtimeChannel = client()
    .channel(`pact-messages:${pactId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pact_messages', filter: `pact_id=eq.${pactId}` }, (payload) => onMessage(toMessage(payload.new as MessageRow)))
    .subscribe((status) => onStatus(status))
  return () => { void client().removeChannel(channel) }
}

