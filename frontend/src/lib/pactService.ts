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
  if (/invite code not found/i.test(message)) return 'That invitation code is invalid or has expired.'
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

  // Fetch only active membership keys in one request. RLS decides whether the
  // signed-in user can see all active members of each authorized Pact.
  const membershipCountResult = await client()
    .from('pact_members')
    .select('pact_id')
    .in('pact_id', pactIds)
    .eq('membership_status', 'active')
  let memberCounts: Map<string, number> | null = null
  if (membershipCountResult.error) {
    logRetrievalFailure('count active pact members', { userId, pactIds }, membershipCountResult.error)
  } else {
    memberCounts = new Map<string, number>()
    for (const row of membershipCountResult.data ?? []) memberCounts.set(row.pact_id, (memberCounts.get(row.pact_id) ?? 0) + 1)
  }

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

// This is intentionally a pending adapter. Vamsi still needs to provide the
// live invitation RPC's parameter names, return value, and authorization rules.
// Keeping the boundary here prevents the UI from treating an arbitrary UUID or
// unverified code as permission to join a private Pact.
export async function requestJoinPact(_request: JoinPactRequest): Promise<never> {
  throw new Error('Invitation acceptance is not connected yet. Vamsi’s backend contract is required.')
}

export async function getPactWorkspace(pactId: string): Promise<PactWorkspace> {
  const { data: authData, error: authError } = await client().auth.getUser()
  if (authError) throw authError
  const userId = authData.user?.id
  if (!userId) throw new Error('Your sign-in session has expired. Please sign in again.')

  const membersResult = await client()
    .from('pact_members')
    .select('user_id, role, membership_status, joined_at')
    .eq('pact_id', pactId)
    .eq('membership_status', 'active')
    .order('joined_at', { ascending: true })
  if (membersResult.error) {
    logRetrievalFailure('load workspace memberships', { userId, pactId }, membersResult.error)
    throw membersResult.error
  }
  const membershipRows = membersResult.data ?? []
  if (!membershipRows.some((member) => member.user_id === userId)) {
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

  // Do not make authorized Pact retrieval depend on optional profile columns.
  // Member display names can be added once the live profile contract is known.
  const members = membershipRows.map((member) => ({ user_id: member.user_id, role: member.role, joined_at: member.joined_at, profile: null })) as PactMember[]
  return { id: pactResult.data.pact_id, name: pactResult.data.name, created_by: pactResult.data.created_by, created_at: pactResult.data.created_at, member_count: members.length, members }
}
