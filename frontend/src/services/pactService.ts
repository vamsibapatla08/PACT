import { supabase } from '../lib/supabase'
import type { PactWithMemberCount } from '../types'

export async function listMyPacts(): Promise<PactWithMemberCount[]> {
  if (!supabase) return []

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  // Get pact memberships for this user
  const { data: memberships, error: memErr } = await supabase
    .from('pact_members')
    .select('pact_id, role')
    .eq('user_id', user.id)

  if (memErr) throw new Error(memErr.message)
  if (!memberships || memberships.length === 0) return []

  const pactIds = memberships.map((m) => m.pact_id)

  // Get pact details
  const { data: pacts, error: pactsErr } = await supabase
    .from('pacts')
    .select('*')
    .in('id', pactIds)

  if (pactsErr) throw new Error(pactsErr.message)
  if (!pacts) return []

  // Get member counts for each pact
  const countPromises = pactIds.map((id) =>
    supabase!
      .from('pact_members')
      .select('pact_id', { count: 'exact', head: true })
      .eq('pact_id', id)
      .then(({ count }) => ({ id, count: count ?? 0 }))
  )
  const counts = await Promise.all(countPromises)
  const countMap = new Map(counts.map((c) => [c.id, c.count]))
  const roleMap = new Map(memberships.map((m) => [m.pact_id, m.role as 'host' | 'member']))

  return pacts.map((pact) => ({
    ...pact,
    member_count: countMap.get(pact.id) ?? 0,
    user_role: roleMap.get(pact.id) ?? 'member',
  }))
}

export async function createPact(name: string): Promise<{ id: string }> {
  if (!supabase) throw new Error('Supabase is not configured.')

  const { data, error } = await supabase
    .from('pacts')
    .insert({ name: name.trim() })
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('No data returned after creating pact.')

  return { id: data.id }
}

export async function joinPact(inviteCode: string): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.')

  const { data, error } = await supabase.rpc('join_pact', {
    p_invite_code: inviteCode,
  })

  if (error) {
    if (error.message.toLowerCase().includes('not found') || error.code === 'PGRST116') {
      throw new Error('Invite code not found. Please check the code and try again.')
    }
    throw new Error(error.message)
  }

  return data as string
}
