import { useEffect } from 'react'
import type { User } from '@supabase/supabase-js'

interface UseProtectedRouteParams {
  user: User | null
  loading: boolean
}

export function useProtectedRoute({ user, loading }: UseProtectedRouteParams): void {
  useEffect(() => {
    if (!loading && user === null) {
      window.history.pushState({}, '', '/')
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
  }, [user, loading])
}
