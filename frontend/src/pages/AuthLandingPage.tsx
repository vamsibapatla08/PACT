import { lazy, Suspense, useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { BrandHeader } from '../components/BrandHeader'
import { GoogleSignInButton } from '../components/GoogleSignInButton'
import { SceneFallback } from '../components/SceneFallback'
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
      <div className="grain" aria-hidden="true" />
      <div className="top-glow" aria-hidden="true" />
      <div className="global-finance-bg" aria-hidden="true">
        <div className="global-orbit orbit-wide" />
        <div className="global-orbit orbit-tall" />
        <div className="bg-medallion medallion-split">÷</div>
        <div className="bg-medallion medallion-value">$</div>
        <div className="bg-medallion medallion-check">✓</div>
        <div className="ledger-ticks"><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div>
        <svg className="global-route" viewBox="0 0 1440 900" preserveAspectRatio="none">
          <path d="M-80 660 C190 520 365 780 610 625 S1010 450 1510 650" />
          <path d="M210 -40 C390 170 590 56 770 220 S1120 420 1490 240" />
        </svg>
        <div className="ambient-particles"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
        <div className="market-panel">
          <div className="market-label"><span /> MARKET MOTION <small>VISUAL</small></div>
          <div className="candlesticks"><i /><i /><i /><i /><i /><i /><i /><i /></div>
        </div>
        <div className="allocation-wheel"><span>4</span><small>SHARED<br />PARTS</small></div>
        <div className="payment-card-shape"><span className="card-chip" /><b>PACT</b><i>•••• 2026</i></div>
        <div className="value-stack"><i /><i /><i /><i /><span>VALUE</span></div>
        <svg className="market-curve" viewBox="0 0 320 120" preserveAspectRatio="none">
          <defs><linearGradient id="marketFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#dcb866" stopOpacity=".18"/><stop offset="1" stopColor="#dcb866" stopOpacity="0"/></linearGradient></defs>
          <path className="market-area" d="M0 108 C35 98 52 70 82 78 S132 96 159 55 S212 74 238 41 S278 48 320 12 L320 120 L0 120 Z" />
          <path className="market-line" d="M0 108 C35 98 52 70 82 78 S132 96 159 55 S212 74 238 41 S278 48 320 12" />
        </svg>
      </div>
      <BrandHeader />

      <section className="hero" aria-labelledby="hero-title">
        <div className="left-finance-field" aria-hidden="true">
          <div className="finance-token token-dollar"><span>$</span></div>
          <div className="finance-token token-verified"><span>✓</span></div>
          <div className="ledger-card">
            <div className="ledger-label"><span /> PACT / VALUE FLOW</div>
            <div className="ledger-bars"><i /><i /><i /><i /><i /></div>
            <small>SPLIT&nbsp;&nbsp;·&nbsp;&nbsp;APPROVE&nbsp;&nbsp;·&nbsp;&nbsp;SETTLE</small>
          </div>
          <svg className="transfer-map" viewBox="0 0 620 520" preserveAspectRatio="none">
            <path d="M18 92 C152 28 216 182 338 116 S496 44 602 102" />
            <path d="M6 406 C132 342 213 468 329 366 S498 282 618 348" />
            <circle className="transfer-node node-one" r="4" cx="18" cy="92" />
            <circle className="transfer-node node-two" r="4" cx="6" cy="406" />
          </svg>
        </div>
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
