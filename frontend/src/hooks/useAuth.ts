import { useState, useEffect, useCallback } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types'

export interface UseAuthReturn {
  user: User | null
  profile: Profile | null
  loading: boolean
  signOut: () => Promise<void>
}

export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchProfile = useCallback(async (uid: string, retry = true) => {
    if (!supabase) return
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .single()

    if (error || !data) {
      if (retry) {
        // Profile trigger may not have fired yet — retry once after 1s
        setTimeout(() => fetchProfile(uid, false), 1000)
      }
      return
    }
    setProfile(data as Profile)
  }, [])

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    // Initial session check
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null
      setUser(u)
      if (u) {
        fetchProfile(u.id)
      }
      setLoading(false)
    })

    // Subscribe to auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null
      setUser(u)
      if (u) {
        fetchProfile(u.id)
      } else {
        setProfile(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [fetchProfile])

  const signOut = useCallback(async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    window.history.pushState({}, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, [])

  return { user, profile, loading, signOut }
}
