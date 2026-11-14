import { useEffect, useRef } from 'react'

type Particle = {
  x: number
  y: number
  radius: number
  depth: number
  speed: number
  sway: number
  phase: number
  alpha: number
}

// Fine Champagne Gold Dust / Bokeh Particles.
// The canvas stays transparent so the existing Pact atmosphere remains visible.
export function GalaxyBackground() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    let seed = 91731
    const random = () => {
      seed = (seed * 16807) % 2147483647
      return (seed - 1) / 2147483646
    }
    const particles: Particle[] = Array.from({ length: 72 }, () => {
      const depth = 0.18 + random() * 0.82
      return { x: random(), y: random(), radius: 0.45 + depth * 2.05, depth, speed: 0.0017 + depth * 0.005, sway: 3 + random() * 13, phase: random() * Math.PI * 2, alpha: 0.12 + depth * 0.38 }
    })

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let width = 0, height = 0, frame = 0, last = 0, elapsed = 0
    const resize = () => {
      width = window.innerWidth; height = window.innerHeight
      const scale = Math.min(window.devicePixelRatio || 1, 1.5)
      canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale)
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`
      context.setTransform(scale, 0, 0, scale, 0, 0)
    }
    const drawParticle = (particle: Particle, index: number) => {
      const y = ((particle.y - elapsed * particle.speed) % 1 + 1) % 1
      const x = particle.x * width + Math.sin(elapsed * 0.12 + particle.phase) * particle.sway * particle.depth
      const radius = particle.radius * (0.94 + Math.sin(elapsed * 0.45 + particle.phase) * 0.08)
      const pulse = 0.84 + Math.sin(elapsed * 0.65 + particle.phase) * 0.16
      const glow = context.createRadialGradient(x, y * height, 0, x, y * height, radius * 5.2)
      glow.addColorStop(0, `rgba(255, 226, 157, ${particle.alpha * pulse})`)
      glow.addColorStop(0.18, `rgba(216, 174, 91, ${particle.alpha * 0.42})`)
      glow.addColorStop(1, 'rgba(177, 126, 43, 0)')
      context.fillStyle = glow; context.beginPath(); context.arc(x, y * height, radius * 5.2, 0, Math.PI * 2); context.fill()
      context.globalAlpha = particle.alpha * pulse; context.fillStyle = index % 5 === 0 ? '#f7d58c' : '#c69a4f'
      context.beginPath(); context.arc(x, y * height, radius, 0, Math.PI * 2); context.fill(); context.globalAlpha = 1
    }
    const draw = () => {
      context.clearRect(0, 0, width, height); context.globalCompositeOperation = 'screen'
      particles.slice().sort((a, b) => a.depth - b.depth).forEach(drawParticle)
      context.globalCompositeOperation = 'source-over'
    }
    const tick = (now: number) => {
      const delta = Math.min((now - last) / 1000, 0.05)
      if (now - last >= 32) { elapsed += delta; last = now; draw() }
      frame = requestAnimationFrame(tick)
    }
    const start = () => { cancelAnimationFrame(frame); last = performance.now(); if (!document.hidden && !reduceMotion.matches) frame = requestAnimationFrame(tick); else draw() }
    resize(); draw(); start()
    window.addEventListener('resize', resize); document.addEventListener('visibilitychange', start); reduceMotion.addEventListener('change', start)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', start); reduceMotion.removeEventListener('change', start) }
  }, [])

  return <canvas ref={ref} className="living-background" aria-hidden="true" />
}
