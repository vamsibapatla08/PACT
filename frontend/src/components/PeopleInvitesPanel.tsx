import type { Profile, PactWorkspace } from '../types/pact'
import type { User } from '@supabase/supabase-js'
import { avatarUrl, displayName } from './AppShell'

type Props = { pact: PactWorkspace; user: User; profile: Profile | null; inviteCode: string | null; inviteError: string | null; inviteLoading: boolean; copied: boolean; onInvite: () => void }

export function PeopleInvitesPanel({ pact, user, profile, inviteCode, inviteError, inviteLoading, copied, onInvite }: Props) {
  return <div className="people-invites-grid">
    <div><p className="section-kicker">MEMBERS / {String(pact.members.length).padStart(2, '0')}</p><div className="member-list">{pact.members.map((member) => { const mine = member.user_id === user.id; const name = member.profile?.full_name || (mine ? displayName(user, profile) : 'Pact member'); const avatar = member.profile?.avatar_url || (mine ? avatarUrl(user, profile) : null); return <div className="member-row" key={member.user_id}>{avatar ? <img src={avatar} alt="" referrerPolicy="no-referrer" /> : <span>{name.charAt(0)}</span>}<strong>{name}{mine ? ' (you)' : ''}</strong><small>{member.role}</small></div> })}</div></div>
    <div className="people-invites-action"><p>Generate a secure invitation for someone you trust.</p><code>{inviteCode || 'NO INVITATION GENERATED'}</code>{inviteError ? <p className="form-error" role="alert">{inviteError}</p> : null}<button className="outline-button" type="button" onClick={onInvite} disabled={inviteLoading}>{inviteLoading ? 'Creating invite…' : copied ? 'Copied' : inviteCode ? 'Copy invite code' : 'Generate invitation'}</button></div>
  </div>
}
