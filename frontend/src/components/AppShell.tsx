import type { ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import type { Profile } from '../types/pact'

type Props = { user: User; profile: Profile | null; current: 'dashboard' | 'pacts'; onNavigate: (path: string) => void; onSignOut: () => Promise<void>; signingOut: boolean; children: ReactNode }

export function displayName(user: User, profile?: Profile | null) {
  return profile?.full_name || user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'there'
}
export function firstName(user: User, profile?: Profile | null) { return displayName(user, profile).trim().split(/\s+/)[0] || 'there' }
export function avatarUrl(user: User, profile?: Profile | null) { return profile?.avatar_url || user.user_metadata?.avatar_url || user.user_metadata?.picture || null }

export function AppShell({ user, profile, current, onNavigate, onSignOut, signingOut, children }: Props) {
  const name = displayName(user, profile); const avatar = avatarUrl(user, profile)
  return <main className="app-page">
    <div className="app-grain" aria-hidden="true" /><div className="app-ambient" aria-hidden="true"><i /><i /><i /><i /><i /></div>
    <header className="app-nav">
      <button className="app-brand" type="button" onClick={() => onNavigate('/dashboard')} aria-label="Pact dashboard"><img src="/pact-logo.png" alt="" /><span>PACT</span></button>
      <nav aria-label="Primary navigation"><button className={current === 'dashboard' ? 'is-active' : ''} type="button" onClick={() => onNavigate('/dashboard')}>Dashboard</button><button className={current === 'pacts' ? 'is-active' : ''} type="button" onClick={() => onNavigate('/dashboard#my-pacts')}>My Pacts</button></nav>
      <div className="account-menu"><div className="account-identity">{avatar ? <img src={avatar} alt="" referrerPolicy="no-referrer" /> : <span>{name.charAt(0).toUpperCase()}</span>}<strong>{name}</strong></div><button className="sign-out" type="button" onClick={onSignOut} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign Out'}</button></div>
    </header>
    <div className="app-content">{children}</div>
  </main>
}
