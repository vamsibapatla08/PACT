import { useState } from 'react'
import { motion } from 'motion/react'
import { hasSupabaseConfig, supabase } from '../lib/supabase'

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20">
      <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.6h3.3c1.9-1.8 2.9-4.4 2.9-7.5Z" />
      <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.3l-3.3-2.6c-.9.6-2.1 1-3.4 1a5.9 5.9 0 0 1-5.5-4.1H3.1v2.7A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.5 14a6 6 0 0 1 0-3.9V7.4H3.1a10 10 0 0 0 0 9.3L6.5 14Z" />
      <path fill="#EA4335" d="M12 6a5.4 5.4 0 0 1 3.8 1.5l2.9-2.8A9.7 9.7 0 0 0 3.1 7.4l3.4 2.7A5.9 5.9 0 0 1 12 6Z" />
    </svg>
  )
}

export function GoogleSignInButton() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signIn = async () => {
    if (loading) return
    if (!hasSupabaseConfig || !supabase) {
      setError('Google sign-in is waiting for the Supabase project configuration.')
      return
    }

    setLoading(true)
    setError(null)
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}${import.meta.env.VITE_POST_AUTH_REDIRECT || '/dashboard'}`,
      },
    })

    if (authError) {
      setError(authError.message || 'Google sign-in could not start. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="auth-action">
      <motion.button
        className="google-button"
        type="button"
        onClick={signIn}
        disabled={loading}
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.985 }}
        aria-describedby={error ? 'auth-error' : 'auth-reassurance'}
      >
        <span className="button-shine" />
        {loading ? <span className="spinner" aria-hidden="true" /> : <GoogleMark />}
        <span>{loading ? 'Opening Google…' : 'Continue with Google'}</span>
        <svg className="button-arrow" aria-hidden="true" viewBox="0 0 24 24">
          <path d="M5 12h13M13 7l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </motion.button>
      <div id="auth-reassurance" className="reassurance">
        <span><i className="lock-dot" /> Supabase secured</span>
        <b />
        <span>No password required</span>
      </div>
      {error && <p id="auth-error" className="auth-error" role="alert">{error}</p>}
    </div>
  )
}
