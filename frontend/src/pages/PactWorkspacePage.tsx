import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { User } from '@supabase/supabase-js'
import { AppShell, avatarUrl, displayName } from '../components/AppShell'
import { StatusPanel } from '../components/StatusPanel'
import { createPactInvitation, friendlyError, getPactWorkspace } from '../lib/pactService'
import type { PactWorkspace, Profile } from '../types/pact'

type Props = { user: User; profile: Profile | null; pactId: string; onNavigate: (path: string) => void; onSignOut: () => Promise<void>; signingOut: boolean }

export function PactWorkspacePage({ user, profile, pactId, onNavigate, onSignOut, signingOut }: Props) {
  const reduceMotion = useReducedMotion()
  const [pact, setPact] = useState<PactWorkspace | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let active = true
    getPactWorkspace(pactId).then((value) => { if (active) setPact(value) }).catch((reason) => { if (active) setError(friendlyError(reason, 'This Pact could not be opened.')) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [pactId])

  async function handleInvite() {
    if (inviteCode) {
      try {
        await navigator.clipboard.writeText(inviteCode)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1800)
      } catch { setInviteError('Copy was blocked. Select the invitation code and copy it manually.') }
      return
    }
    setInviteLoading(true); setInviteError(null)
    try { setInviteCode(await createPactInvitation(pactId)); setCopied(false) }
    catch (reason) { setInviteError(friendlyError(reason, 'The invitation could not be created for this Pact.')) }
    finally { setInviteLoading(false) }
  }

  return <AppShell user={user} profile={profile} current="pacts" onNavigate={onNavigate} onSignOut={onSignOut} signingOut={signingOut}>
    <motion.section className="workspace-page" initial={reduceMotion ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .65 }}>
      <button className="back-link" type="button" onClick={() => onNavigate('/dashboard')}>← My Pacts</button>
      {loading ? <div className="loading-line"><span /> Opening your Pact…</div> : null}
      {error ? <StatusPanel title="Pact unavailable." message={error} actionLabel="Return to dashboard" onAction={() => onNavigate('/dashboard')} /> : null}
      {pact ? <>
        <div className="workspace-heading"><div><p className="section-kicker">PACT / WORKSPACE</p><h1>{pact.name}</h1><p>Shared planning starts here.</p></div><span className="status-chip"><i /> Active</span></div>
        <div className="workspace-grid">
          <section className="workspace-card"><p className="section-kicker">MEMBERS / {pact.members.length.toString().padStart(2, '0')}</p><h2>People in this Pact</h2><div className="member-list">{pact.members.map((member) => { const isCurrentUser = member.user_id === user.id; const memberName = member.profile?.full_name || (isCurrentUser ? displayName(user, profile) : 'Pact member'); const memberAvatar = member.profile?.avatar_url || (isCurrentUser ? avatarUrl(user, profile) : null); return <div className="member-row" key={member.user_id}>{memberAvatar ? <img src={memberAvatar} alt="" referrerPolicy="no-referrer" /> : <span>{memberName.charAt(0)}</span>}<strong>{memberName}{isCurrentUser ? ' (you)' : ''}</strong><small>{member.role}</small></div> })}</div></section>
          <section className="workspace-card invite-card"><p className="section-kicker">INVITATION / SHARE</p><h2>Bring your people in.</h2><p>Generate a secure invitation for someone you trust.</p><code>{inviteCode || 'NO INVITATION GENERATED'}</code>{inviteError ? <p className="form-error" role="alert">{inviteError}</p> : null}<button className="outline-button" type="button" onClick={handleInvite} disabled={inviteLoading}>{inviteLoading ? 'Creating invite…' : copied ? 'Copied' : inviteCode ? 'Copy invite code' : 'Generate invitation'}</button></section>
        </div>
        <section className="workspace-coming"><span>PACT / NEXT LAYER</span><strong>Conversation, decisions, and payments will live here.</strong><p>Chat, plans, votes, and payment features are not in the current backend migration yet.</p></section>
      </> : null}
    </motion.section>
  </AppShell>
}
