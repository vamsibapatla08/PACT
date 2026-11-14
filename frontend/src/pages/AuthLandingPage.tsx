import { lazy, Suspense, useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { BrandHeader } from '../components/BrandHeader'
import { GoogleSignInButton } from '../components/GoogleSignInButton'
import { SceneFallback } from '../components/SceneFallback'
import { PactBackground } from '../components/PactBackground'
import { supabase } from '../lib/supabase'

const PactCoinScene = lazy(() => import('../components/PactCoinScene').then((module) => ({ default: module.PactCoinScene })))

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(window.WebGL2RenderingContext && canvas.getContext('webgl2'))
  } catch { return false }
}

export function AuthLandingPage() {
  const reduceMotion = useReducedMotion()
  const [webgl] = useState(supportsWebGL)

  useEffect(() => {
    if (!supabase) return
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session && window.location.pathname === '/') {
        window.location.assign(import.meta.env.VITE_POST_AUTH_REDIRECT || '/dashboard')
      }
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  return (
    <main className="auth-page">
      <PactBackground />
      <BrandHeader />

      <section className="hero" aria-labelledby="hero-title">
        <motion.div className="hero-copy" initial={reduceMotion ? false : { opacity: 0, x: -26 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.9, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}>
          <div className="eyebrow">Shared planning / One clear path forward</div>
          <h1 id="hero-title">
            <span className="headline-clip"><motion.span initial={reduceMotion ? false : { y: '115%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.9, delay: 0.22, ease: [0.16, 1, 0.3, 1] }}>Make the plan.</motion.span></span>
            <span className="headline-clip"><motion.em initial={reduceMotion ? false : { y: '115%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.95, delay: 0.34, ease: [0.16, 1, 0.3, 1] }}>Make it happen.</motion.em></span>
          </h1>
          <motion.p className="hero-description" initial={reduceMotion ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.58 }}>Bring the conversation, the decision, and every shared payment into one place—without the usual group chaos.</motion.p>
          <div className="financial-marks" aria-hidden="true"><span>PLAN</span><b /><span>CONSENSUS</span><b /><span>COMMIT</span></div>
          <GoogleSignInButton />
        </motion.div>

        <motion.div className="scene-wrap" initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.2, delay: 0.05, ease: [0.16, 1, 0.3, 1] }} aria-hidden="true">
          <div className="scene-aura" />
          {webgl && !reduceMotion ? <Suspense fallback={<SceneFallback />}><PactCoinScene /></Suspense> : <SceneFallback />}
        </motion.div>
      </section>
    </main>
  )
}
