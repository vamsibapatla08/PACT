import { useEffect, useState } from 'react'
import { BrandHeader } from '../components/BrandHeader'
import { supabase } from '../lib/supabase'
import type { User } from '@supabase/supabase-js'

export function DashboardPage() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    const client = supabase
    if (!client) {
      window.location.replace('/')
      return
    }

    let active = true
    const loadSession = async () => {
      const { data, error } = await client.auth.getSession()
      if (error) {
        console.error('Unable to load the authenticated session.', error)
      }
      if (!active) return
      if (!data.session) {
        window.location.replace('/')
        return
      }
      setUser(data.session.user)
      setLoading(false)
    }

    void loadSession()
    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        window.location.replace('/')
        return
      }
      if (!session) return
      setUser(session.user)
      setLoading(false)
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  const signOut = async () => {
    const client = supabase
    if (!client || signingOut) return
    setSigningOut(true)
    const { error } = await client.auth.signOut()
    if (error) {
      console.error('Unable to sign out.', error)
      setSigningOut(false)
    }
  }

  if (loading) {
    return (
      <main className="dashboard-page">
        <p className="dashboard-status">Loading your Pact...</p>
      </main>
    )
  }

  return (
    <main className="dashboard-page">
      <div className="grain" aria-hidden="true" />
      <div className="top-glow" aria-hidden="true" />
      <BrandHeader />
      <section className="dashboard-content" aria-labelledby="dashboard-title">
        <div className="eyebrow">Your shared workspace</div>
        <h1 id="dashboard-title">Welcome to Pact.</h1>
        <p className="dashboard-description">
          You&apos;re signed in{user?.email ? ` as ${user.email}` : ''}. Create a plan, invite your group, and keep every decision and payment together.
        </p>
        <div className="dashboard-actions">
          <button className="dashboard-primary" type="button">Create a Pact</button>
          <button className="dashboard-secondary" type="button" onClick={() => void signOut()} disabled={signingOut}>
            {signingOut ? 'Signing out...' : 'Sign out'}
          </button>
        </div>
      </section>
    </main>
  )
}
