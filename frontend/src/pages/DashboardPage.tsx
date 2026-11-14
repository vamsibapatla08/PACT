import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { User } from '@supabase/supabase-js'
import { AppShell, firstName } from '../components/AppShell'
import { StatusPanel } from '../components/StatusPanel'
import { friendlyError, getProfile, listPacts } from '../lib/pactService'
import type { PactSummary, Profile } from '../types/pact'

type Props = {
  user: User
  profile: Profile | null
  onNavigate: (path: string) => void
  onSignOut: () => Promise<void>
  signingOut: boolean
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date))
}

export function DashboardPage({ user, profile: initialProfile, onNavigate, onSignOut, signingOut }: Props) {
  const reduceMotion = useReducedMotion()
  const [profile, setProfile] = useState(initialProfile)
  const [pacts, setPacts] = useState<PactSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([getProfile(user), listPacts(user.id)])
      .then(([nextProfile, nextPacts]) => {
        if (!active) return
        setProfile(nextProfile)
        setPacts(nextPacts)
        setError(null)
      })
      .catch((reason) => {
        if (active) setError(friendlyError(reason, 'Your Pact data could not be loaded yet.'))
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [user])

  return (
    <AppShell user={user} profile={profile} current="dashboard" onNavigate={onNavigate} onSignOut={onSignOut} signingOut={signingOut}>
      <section className="welcome-block">
        <motion.div initial={reduceMotion ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, ease: [.22, 1, .36, 1] }}>
          <p className="section-kicker">PACT / YOUR SPACE</p>
          <h1>Welcome to Pact, <em>{firstName(user, profile)}.</em></h1>
          <p className="welcome-subtitle">Plan together. Decide together. Make it happen.</p>
        </motion.div>
        <div className="welcome-mark" aria-hidden="true"><span>↗</span><i /><b /></div>
      </section>

      <section className="action-grid" aria-label="Pact actions">
        <motion.button className="action-card action-card-primary" type="button" onClick={() => onNavigate('/pacts/create')} initial={reduceMotion ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .65, delay: .1 }}>
          <span className="action-index">01 / BEGIN</span>
          <strong>Create a Pact</strong>
          <span>Start a new shared plan.</span>
          <i aria-hidden="true">↗</i>
        </motion.button>
        <motion.button className="action-card" type="button" onClick={() => onNavigate('/pacts/join')} initial={reduceMotion ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .65, delay: .18 }}>
          <span className="action-index">02 / ENTER</span>
          <strong>Join a Pact</strong>
          <span>Use an invitation from your group.</span>
          <i aria-hidden="true">→</i>
        </motion.button>
      </section>

      <section id="my-pacts" className="pacts-section">
        <div className="section-heading"><div><p className="section-kicker">PACT / SHARED PLANS</p><h2>My Pacts</h2></div><span>{loading ? 'SYNCING' : `${pacts.length.toString().padStart(2, '0')} ACTIVE`}</span></div>
        {error ? <StatusPanel title="Your Pacts are temporarily unavailable." message={error} actionLabel="Retry" onAction={() => window.location.reload()} /> : null}
        {!error && loading ? <div className="loading-line"><span /> Restoring your Pact space…</div> : null}
        {!error && !loading && pacts.length === 0 ? <StatusPanel title="No Pacts yet." message="Your next plan is one click away." actionLabel="Create your first Pact" onAction={() => onNavigate('/pacts/create')} /> : null}
        {!error && !loading && pacts.length > 0 ? <div className="pact-grid">{pacts.map((pact) => <PactCard key={pact.id} pact={pact} onOpen={() => onNavigate(`/pacts/${pact.id}`)} />)}</div> : null}
      </section>
    </AppShell>
  )
}

function PactCard({ pact, onOpen }: { pact: PactSummary; onOpen: () => void }) {
  return (
    <button className="pact-card" type="button" onClick={onOpen}>
      <div className="pact-card-top"><span className="pact-dot" /> <span>ACTIVE PLAN</span><small>{formatDate(pact.created_at)}</small></div>
      <strong>{pact.name}</strong>
      <div className="pact-card-meta"><span>{pact.member_count === null ? 'Members unavailable' : `${pact.member_count} member${pact.member_count === 1 ? '' : 's'}`}</span><span>Open Pact →</span></div>
    </button>
  )
}
