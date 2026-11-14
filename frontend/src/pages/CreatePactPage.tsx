import { FormEvent, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { User } from '@supabase/supabase-js'
import { AppShell } from '../components/AppShell'
import { friendlyError, createPact } from '../lib/pactService'
import type { Profile } from '../types/pact'

type Props = { user: User; profile: Profile | null; onNavigate: (path: string) => void; onSignOut: () => Promise<void>; signingOut: boolean }

export function CreatePactPage({ user, profile, onNavigate, onSignOut, signingOut }: Props) {
  const reduceMotion = useReducedMotion()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const cleanName = name.trim()
    if (!cleanName) { setError('Give your Pact a name before continuing.'); return }
    if (cleanName.length > 120) { setError('Keep the Pact name under 120 characters.'); return }
    setSaving(true); setError(null)
    try {
      const pact = await createPact(cleanName)
      onNavigate(`/pacts/${pact.id}`)
    } catch (reason) {
      setError(friendlyError(reason, 'The Pact could not be created. Please try again.'))
      setSaving(false)
    }
  }

  return <AppShell user={user} profile={profile} current="pacts" onNavigate={onNavigate} onSignOut={onSignOut} signingOut={signingOut}>
    <motion.section className="form-page" initial={reduceMotion ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .65 }}>
      <button className="back-link" type="button" onClick={() => onNavigate('/dashboard')}>← Back to dashboard</button>
      <p className="section-kicker">PACT / NEW SHARED PLAN</p>
      <h1>Create a Pact.</h1>
      <p className="form-intro">Give the group one clear place to plan, decide, and move forward together.</p>
      <form className="pact-form" onSubmit={submit}>
        <label htmlFor="pact-name">Pact name <span>Required</span></label>
        <input id="pact-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Austin weekend" maxLength={120} autoFocus />
        <p className="field-note">The database currently supports the Pact name. Purpose, budget, dates, and payment planning will be added with their backend migrations.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="gold-button" type="submit" disabled={saving}>{saving ? 'Creating Pact…' : 'Create Pact'}<span>↗</span></button>
      </form>
    </motion.section>
  </AppShell>
}
