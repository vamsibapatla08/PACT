import { FormEvent, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { User } from '@supabase/supabase-js'
import { AppShell } from '../components/AppShell'
import { friendlyError, joinPact } from '../lib/pactService'
import type { Profile } from '../types/pact'

type Props = { user: User; profile: Profile | null; initialInvitation?: string; onNavigate: (path: string) => void; onSignOut: () => Promise<void>; signingOut: boolean }

export function JoinPactPage({ user, profile, initialInvitation = '', onNavigate, onSignOut, signingOut }: Props) {
  const reduceMotion = useReducedMotion()
  const [invitation, setInvitation] = useState(initialInvitation)
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!invitation.trim()) { setError('Enter an invitation code or link to continue.'); return }
    setJoining(true); setError(null)
    try {
      const pactId = await joinPact(invitation)
      onNavigate(`/pacts/${pactId}`)
    } catch (reason) {
      setError(friendlyError(reason, 'That invitation could not be accepted. Please check it and try again.'))
      setJoining(false)
    }
  }

  return <AppShell user={user} profile={profile} current="pacts" onNavigate={onNavigate} onSignOut={onSignOut} signingOut={signingOut}>
    <motion.section className="form-page" initial={reduceMotion ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .65 }}>
      <button className="back-link" type="button" onClick={() => onNavigate('/dashboard')}>← Back to dashboard</button>
      <p className="section-kicker">PACT / INVITATION</p>
      <h1>Join a Pact.</h1>
      <p className="form-intro">Enter the invitation your group shared with you. Access is confirmed by the Pact backend.</p>
      <form className="pact-form" onSubmit={submit}>
        <label htmlFor="invite-code">Invitation code or link <span>Required</span></label>
        <input id="invite-code" value={invitation} onChange={(event) => setInvitation(event.target.value)} placeholder="austin26 or an invitation link" autoFocus />
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="gold-button" type="submit" disabled={joining}>{joining ? 'Joining Pact…' : 'Join Pact'}<span>→</span></button>
      </form>
    </motion.section>
  </AppShell>
}
