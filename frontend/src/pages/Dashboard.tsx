import { useState, useEffect, useCallback } from 'react'
import { motion } from 'motion/react'
import { useAuth } from '../hooks/useAuth'
import { useProtectedRoute } from '../hooks/useProtectedRoute'
import { listMyPacts } from '../services/pactService'
import { CreatePactModal } from '../components/CreatePactModal'
import { JoinPactModal } from '../components/JoinPactModal'
import { hasSupabaseConfig } from '../lib/supabase'
import type { PactWithMemberCount } from '../types'

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function getFirstName(fullName: string | null, email: string | undefined): string {
  if (fullName) return fullName.split(' ')[0]
  if (email) return email.split('@')[0]
  return 'there'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function UserAvatar({ name, avatarUrl }: { name: string | null; avatarUrl: string | null }) {
  const initials = name
    ? name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
    : '?'

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name ?? 'User avatar'}
        className="user-avatar user-avatar--img"
        referrerPolicy="no-referrer"
      />
    )
  }
  return <div className="user-avatar">{initials}</div>
}

export function Dashboard() {
  const { user, profile, loading, signOut } = useAuth()
  useProtectedRoute({ user, loading })

  const [pacts, setPacts] = useState<PactWithMemberCount[]>([])
  const [pactsLoading, setPactsLoading] = useState(true)
  const [pactsError, setPactsError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showJoin, setShowJoin] = useState(false)

  const loadPacts = useCallback(async () => {
    setPactsLoading(true)
    setPactsError(null)
    try {
      const data = await listMyPacts()
      setPacts(data)
    } catch (err) {
      setPactsError(err instanceof Error ? err.message : 'Failed to load pacts.')
    } finally {
      setPactsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!loading && user) {
      loadPacts()
    }
  }, [loading, user, loadPacts])

  if (!hasSupabaseConfig) {
    return (
      <div className="dash-page">
        <div className="page-loading">
          <p style={{ color: 'var(--gold)', fontFamily: 'Manrope', fontSize: 14 }}>
            Supabase is not configured. Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to your <code>.env</code> file.
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="dash-page">
        <div className="page-loading">
          <div className="spinner" style={{ width: 36, height: 36 }} />
        </div>
      </div>
    )
  }

  if (!user) return null

  const firstName = getFirstName(profile?.full_name ?? null, user.email)

  return (
    <div className="dash-page">
      {/* Nav */}
      <header className="dash-header" role="banner">
        <a href="/" className="brand-lockup" aria-label="PACT Home">
          <img src="/pact-logo.png" alt="PACT logo" width={38} height={38} />
          <span>PACT</span>
          <span className="brand-version">2.0</span>
        </a>

        <nav className="dash-nav" aria-label="Main navigation">
          <a href="/dashboard" className="dash-nav-link active" aria-current="page">Dashboard</a>
          <span className="dash-nav-sep" aria-hidden="true" />
          <a href="/dashboard" className="dash-nav-link">My Pacts</a>
        </nav>

        <div className="dash-user-area">
          <UserAvatar name={profile?.full_name ?? null} avatarUrl={profile?.avatar_url ?? null} />
          <span className="dash-user-name">{profile?.full_name ?? user.email}</span>
          <button
            type="button"
            className="sign-out-btn"
            onClick={signOut}
            aria-label="Sign out"
          >
            Sign Out
          </button>
        </div>
      </header>

      <main className="dash-content" aria-label="Dashboard content">
        {/* Welcome */}
        <motion.section
          className="dash-welcome"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          aria-labelledby="welcome-heading"
        >
          <h1 className="welcome-heading" id="welcome-heading">
            {getGreeting()}, {firstName}.
          </h1>
          <p className="welcome-sub">Your plans, people, and payments — all in one place.</p>
        </motion.section>

        {/* Action Cards */}
        <section className="action-cards-grid" aria-label="Quick actions">
          <motion.div
            className="action-card"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="action-card-icon" aria-hidden="true">＋</div>
            <h2 className="action-card-title">Create a Pact</h2>
            <p className="action-card-desc">Start a shared plan with your group.</p>
            <button
              type="button"
              className="action-card-btn"
              onClick={() => setShowCreate(true)}
            >
              Create Pact
            </button>
          </motion.div>

          <motion.div
            className="action-card"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="action-card-icon" aria-hidden="true">⟶</div>
            <h2 className="action-card-title">Join a Pact</h2>
            <p className="action-card-desc">Enter an invite code to join an existing Pact.</p>
            <button
              type="button"
              className="action-card-btn btn-outline"
              onClick={() => setShowJoin(true)}
            >
              Join Pact
            </button>
          </motion.div>
        </section>

        {/* My Pacts */}
        <motion.section
          className="pacts-section"
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
          aria-labelledby="pacts-heading"
        >
          <h2 className="section-heading" id="pacts-heading">My Pacts</h2>

          {pactsLoading && (
            <div className="pact-status-loading" aria-busy="true" aria-label="Loading pacts">
              <div className="spinner" />
              <span>Loading your pacts…</span>
            </div>
          )}

          {!pactsLoading && pactsError && (
            <div className="pact-status-error" role="alert">
              <span>⚠ {pactsError}</span>
              <button type="button" className="btn-ghost" onClick={loadPacts} style={{ marginTop: 10 }}>
                Retry
              </button>
            </div>
          )}

          {!pactsLoading && !pactsError && pacts.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-icon" aria-hidden="true">P</div>
              <h3 className="empty-state-title">Your next plan starts here.</h3>
              <p className="empty-state-sub">
                Create a Pact to bring your group's shared plans, decisions, and payments into one place.
              </p>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setShowCreate(true)}
              >
                Create Your First Pact
              </button>
            </div>
          )}

          {!pactsLoading && !pactsError && pacts.length > 0 && (
            <div className="pacts-grid">
              {pacts.map((pact, i) => (
                <motion.div
                  key={pact.id}
                  className="pact-card"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, delay: 0.1 * i, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="pact-card-top">
                    <h3 className="pact-card-name">{pact.name}</h3>
                    <span className={`role-badge${pact.user_role === 'host' ? ' host' : ' member'}`}>
                      {pact.user_role.toUpperCase()}
                    </span>
                  </div>
                  <div className="pact-card-meta">
                    <span>
                      <span className="meta-icon" aria-hidden="true">👥</span>
                      {pact.member_count} {pact.member_count === 1 ? 'member' : 'members'}
                    </span>
                    <span>Created {formatDate(pact.created_at)}</span>
                  </div>
                  <div className="pact-card-code">
                    Code: <code>{pact.invite_code}</code>
                  </div>
                  <a
                    href={`/pact/${pact.id}`}
                    className="open-pact-btn"
                    aria-label={`Open pact ${pact.name}`}
                    onClick={(e) => e.preventDefault()}
                    aria-disabled="true"
                  >
                    Open Pact →
                  </a>
                </motion.div>
              ))}
            </div>
          )}
        </motion.section>
      </main>

      <CreatePactModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={loadPacts}
      />
      <JoinPactModal
        open={showJoin}
        onClose={() => setShowJoin(false)}
        onSuccess={loadPacts}
      />
    </div>
  )
}
