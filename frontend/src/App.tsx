import { useState, useEffect } from 'react'
import { AuthLandingPage } from './pages/AuthLandingPage'
import { Dashboard } from './pages/Dashboard'

export function navigate(path: string): void {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function Router() {
  const [path, setPath] = useState(window.location.pathname)

  useEffect(() => {
    const handler = () => setPath(window.location.pathname)
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [])

  if (path === '/dashboard') return <Dashboard />
  return <AuthLandingPage />
}

export default function App() {
  return <Router />
}
