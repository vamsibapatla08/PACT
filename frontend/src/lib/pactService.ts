import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { PactMember, PactSummary, PactWorkspace, Profile } from '../types/pact'

function client() {
  if (!supabase) throw new Error('Pact is not connected to Supabase yet.')
  return supabase
}

function logRetrievalFailure(operation: string, context: Record<string, unknown>, error: { code?: string; message?: string; details?: string; hint?: string }) {
  if (import.meta.env.DEV) console.error(`[Pact retrieval] ${operation}`, { ...context, error: { code: error.code, message: error.message, details: error.details, hint: error.hint } })
}

export function friendlyError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : ''
  if (/invite|invitation|expired|revoked|redeemed/i.test(message)) return 'That invitation code is invalid, expired, or no longer available.'
  if (/row-level security|permission denied|not authorized|jwt/i.test(message)) return 'You do not have permission to access that Pact.'
  if (/fetch|network|timeout/i.test(message)) return 'Pact could not reach the server. Check your connection and try again.'
  return fallback
}

export async function getProfile(user: User): Promise<Profile> {
  // The live profiles table does not expose the legacy full_name field.
  // The authenticated Google user is the verified source for the current
  // user's display data until Vamsi confirms the live profile columns.
  const metadata = user.user_metadata ?? {}
  return {
    id: user.id,
    full_name: metadata.full_name || metadata.name || null,
    avatar_url: metadata.avatar_url || metadata.picture || null,
    created_at: user.created_at,
  }
}

export async function listPacts(userId: string): Promise<PactSummary[]> {
  const membershipResult = await client()
    .from('pact_members')
    .select('pact_id')
    .eq('user_id', userId)
    .eq('membership_status', 'active')
  if (membershipResult.error) {
    logRetrievalFailure('list memberships', { userId }, membershipResult.error)
    throw membershipResult.error
  }
  const pactIds = [...new Set((membershipResult.data ?? []).map((row) => row.pact_id))]
  if (pactIds.length === 0) return []

  const pactResult = await client()
    .from('pacts')
    .select('pact_id, name, created_by, created_at')
    .in('pact_id', pactIds)
    .order('created_at', { ascending: false })
  if (pactResult.error) {
    logRetrievalFailure('list pacts', { userId, pactIds }, pactResult.error)
    throw pactResult.error
  }

  const memberCounts = new Map<string, number>()
  await Promise.all(pactIds.map(async (pactId) => {
    try {
      const members = await listPactMembers(pactId)
      memberCounts.set(pactId, members.length)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) logRetrievalFailure('list Pact members for count', { userId, pactId }, error as { code?: string; message?: string; details?: string; hint?: string })
    }
  }))

  return (pactResult.data ?? []).map((pact) => ({
    id: pact.pact_id,
    name: pact.name,
    created_by: pact.created_by,
    created_at: pact.created_at,
    member_count: memberCounts?.get(pact.pact_id) ?? null,
  }))
}

export async function createPact(name: string): Promise<{ id: string }> {
  const { data: pactId, error } = await client().rpc('create_pact', { p_name: name.trim() })
  if (error) throw error
  if (typeof pactId !== 'string' || !pactId) throw new Error('Pact creation returned no ID.')
  return { id: pactId }
}

export type JoinPactRequest = { invitation: string }

export async function requestJoinPact({ invitation }: JoinPactRequest): Promise<string> {
  const { data: pactId, error } = await client().rpc('join_pact', { p_invite_code: invitation.trim() })
  if (error) throw error
  if (typeof pactId !== 'string' || !pactId) throw new Error('Joining the Pact returned no Pact ID.')
  return pactId
}

export async function createPactInvitation(pactId: string): Promise<string> {
  const { data, error } = await client().rpc('create_pact_invitation', { p_pact_id: pactId })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  const inviteCode = row && typeof row === 'object' && 'invite_code' in row ? row.invite_code : null
  if (typeof inviteCode !== 'string' || !inviteCode) throw new Error('Invitation creation returned no invite code.')
  return inviteCode
}

type PactMemberRpcRow = { user_id?: string; id?: string; role?: string; joined_at?: string | null; name?: string | null; avatar_url?: string | null }

export async function listPactMembers(pactId: string): Promise<PactMemberRpcRow[]> {
  const { data, error } = await client().rpc('list_pact_members', { p_pact_id: pactId })
  if (error) throw error
  return Array.isArray(data) ? data as PactMemberRpcRow[] : []
}

export async function getPactWorkspace(pactId: string): Promise<PactWorkspace> {
  const { data: authData, error: authError } = await client().auth.getUser()
  if (authError) throw authError
  const userId = authData.user?.id
  if (!userId) throw new Error('Your sign-in session has expired. Please sign in again.')

  const memberRows = await listPactMembers(pactId)
  if (!memberRows.some((member) => (member.user_id || member.id) === userId)) {
    logRetrievalFailure('membership denied', { userId, pactId }, { code: 'PACT_NOT_ACTIVE_MEMBER', message: 'No active membership found for the authenticated user.' })
    throw new Error('This Pact does not exist or you do not have active membership.')
  }

  const pactResult = await client()
    .from('pacts')
    .select('pact_id, name, created_by, created_at')
    .eq('pact_id', pactId)
    .maybeSingle()
  if (pactResult.error) {
    logRetrievalFailure('load workspace pact', { userId, pactId }, pactResult.error)
    throw pactResult.error
  }
  if (!pactResult.data) {
    logRetrievalFailure('pact not found', { userId, pactId }, { code: 'PACT_NOT_FOUND', message: 'No visible Pact row matched pact_id.' })
    throw new Error('This Pact does not exist or you do not have access to it.')
  }
  const pact = pactResult.data

  // Do not make authorized Pact retrieval depend on optional profile columns.
  // Member display names can be added once the live profile contract is known.
  const members = memberRows.map((member) => ({
    user_id: member.user_id || member.id || '',
    role: member.role === 'host' ? 'host' : 'member',
    joined_at: member.joined_at || pact.created_at,
    profile: member.name || member.avatar_url ? { id: member.user_id || member.id || '', full_name: member.name || null, avatar_url: member.avatar_url || null } : null,
  })) as PactMember[]
  return { id: pact.pact_id, name: pact.name, created_by: pact.created_by, created_at: pact.created_at, member_count: members.length, members }
}
