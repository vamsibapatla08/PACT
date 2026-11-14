import { useEffect, useMemo, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { AuthLandingPage } from './pages/AuthLandingPage'
import { DashboardPage } from './pages/DashboardPage'
import { CreatePactPage } from './pages/CreatePactPage'
import { JoinPactPage } from './pages/JoinPactPage'
import { PactWorkspacePage } from './pages/PactWorkspacePage'
import { getProfile } from './lib/pactService'
import { hasSupabaseConfig, supabase } from './lib/supabase'
import type { Profile } from './types/pact'

function usePath() {
  const [path, setPath] = useState(() => `${window.location.pathname}${window.location.search}${window.location.hash}`)
  const navigate = (nextPath: string, replace = false) => { const url = new URL(nextPath, window.location.origin); if (replace) window.history.replaceState({}, '', url); else window.history.pushState({}, '', url); setPath(`${url.pathname}${url.search}${url.hash}`) }
  useEffect(() => { const onPopState = () => setPath(`${window.location.pathname}${window.location.search}${window.location.hash}`); window.addEventListener('popstate', onPopState); return () => window.removeEventListener('popstate', onPopState) }, [])
  return { path, navigate }
}
function sessionUser(session: Session | null): User | null { return session?.user ?? null }

export function App() {
  const { path, navigate } = usePath(); const [session, setSession] = useState<Session | null>(null); const [profile, setProfile] = useState<Profile | null>(null); const [authLoading, setAuthLoading] = useState(true); const [profileLoading, setProfileLoading] = useState(false); const [signingOut, setSigningOut] = useState(false)
  const user = sessionUser(session); const route = useMemo(() => parseRoute(path), [path]); const protectedRoute = route.kind !== 'login'

  useEffect(() => { if (!supabase) { setAuthLoading(false); return }; let active = true; supabase.auth.getSession().then(({ data }) => { if (active) { setSession(data.session); setAuthLoading(false) } }); const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => { if (!active) return; setSession(nextSession); if (event === 'SIGNED_OUT') setProfile(null); setAuthLoading(false) }); return () => { active = false; listener.subscription.unsubscribe() } }, [])
  useEffect(() => { if (authLoading) return; if (!user && protectedRoute) navigate('/', true); if (user && route.kind === 'login') navigate('/dashboard', true) }, [authLoading, protectedRoute, user, route.kind])
  useEffect(() => { if (!user || !protectedRoute) return; let active = true; setProfileLoading(true); getProfile(user).then((value) => { if (active) setProfile(value) }).catch(() => { if (active) setProfile(null) }).finally(() => { if (active) setProfileLoading(false) }); return () => { active = false } }, [user?.id, protectedRoute])

  async function signOut() { if (!supabase) return; setSigningOut(true); const { error } = await supabase.auth.signOut(); if (!error) navigate('/', true); setSigningOut(false) }
  if (!hasSupabaseConfig) return <AuthLandingPage />
  if (authLoading) return <div className="session-loading"><span className="loading-emblem">P</span><p>Restoring your Pact space…</p></div>
  if (!user || route.kind === 'login') return <AuthLandingPage />
  if (profileLoading && !profile) return <div className="session-loading"><span className="loading-emblem">P</span><p>Preparing your Pact space…</p></div>
  const common = { user, profile, onNavigate: navigate, onSignOut: signOut, signingOut }
  if (route.kind === 'create') return <CreatePactPage {...common} />
  if (route.kind === 'join') return <JoinPactPage {...common} initialInvitation={route.invitation} />
  if (route.kind === 'workspace') return <PactWorkspacePage {...common} pactId={route.pactId} />
  return <DashboardPage {...common} />
}

type Route = { kind: 'login' } | { kind: 'dashboard' } | { kind: 'create' } | { kind: 'join'; invitation: string } | { kind: 'workspace'; pactId: string }
function parseRoute(path: string): Route { const url = new URL(path, window.location.origin); if (url.pathname === '/' || url.pathname === '/login') return { kind: 'login' }; if (url.pathname === '/pacts/create') return { kind: 'create' }; if (url.pathname === '/pacts/join') return { kind: 'join', invitation: url.searchParams.get('invite') || '' }; if (url.pathname.startsWith('/pacts/')) return { kind: 'workspace', pactId: url.pathname.split('/').filter(Boolean)[1] || '' }; return { kind: 'dashboard' } }
