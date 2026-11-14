import { useEffect, useRef } from 'react'

// Preserve the photographic atmosphere, with independent cloud and dust motion.
export function LivingBackground() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d', { alpha: false })
    if (!canvas || !ctx) return
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const photograph = new Image()
    photograph.src = '/pact-deep-space.jpg'
    let seed = 48271
    const random = () => { seed = seed * 16807 % 2147483647; return (seed - 1) / 2147483646 }
    const dust = Array.from({ length: 1800 }, () => ({
      x: random(), y: random(), depth: .2 + random() * .8,
      spread: (random() + random() + random() - 1.5) * .23,
      phase: random() * Math.PI * 2, gold: random() > .38,
    }))
    const stars = Array.from({ length: 130 }, () => ({ x: random(), y: random(), depth: .2 + random() * .8, phase: random() * 6.28 }))
    const clouds = Array.from({ length: 22 }, (_, i) => ({ x: .48 + random() * .55, y: i / 22, scale: .15 + random() * .2, phase: random() * 6.28, gold: i % 3 === 0 }))
    const makeCloud = (color: string) => {
      const sprite = document.createElement('canvas'); sprite.width = sprite.height = 256
      const c = sprite.getContext('2d')!
      for (let i = 0; i < 75; i++) {
        const x = 38 + random() * 180, y = 38 + random() * 180, r = 12 + random() * 50
        const gradient = c.createRadialGradient(x, y, 0, x, y, r)
        gradient.addColorStop(0, color); gradient.addColorStop(1, 'transparent')
        c.fillStyle = gradient; c.fillRect(x - r, y - r, r * 2, r * 2)
      }
      return sprite
    }
    const blueCloud = makeCloud('rgba(63,100,119,.065)')
    const goldCloud = makeCloud('rgba(153,118,65,.055)')
    let width = 0, height = 0, frame = 0, previous = 0, elapsed = 0
    const resize = () => {
      width = window.innerWidth; height = window.innerHeight
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const draw = () => {
      const t = elapsed
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = '#07090c'; ctx.fillRect(0, 0, width, height)
      if (photograph.complete && photograph.naturalWidth) {
        // Overscan prevents exposed edges as the distant photographic layer drifts.
        const scale = Math.max(width / photograph.naturalWidth, height / photograph.naturalHeight) * 1.035
        const w = photograph.naturalWidth * scale, h = photograph.naturalHeight * scale
        const x = (width - w) / 2 + Math.sin(t * .018) * width * .006
        const y = (height - h) / 2 + Math.cos(t * .015) * height * .006
        ctx.globalAlpha = .9
        ctx.drawImage(photograph, x, y, w, h)
        ctx.globalAlpha = 1
      }
      ctx.globalCompositeOperation = 'screen'
      for (const cloud of clouds) {
        const x = (cloud.x + Math.sin(t * .035 + cloud.phase) * .055) * width
        const y = (cloud.y + Math.cos(t * .025 + cloud.phase) * .055) * height
        const size = width * cloud.scale * (1 + Math.sin(t * .07 + cloud.phase) * .12)
        ctx.globalAlpha = .12 + Math.sin(t * .065 + cloud.phase) * .035
        ctx.drawImage(cloud.gold ? goldCloud : blueCloud, x - size / 2, y - size / 2, size, size)
      }
      for (const p of dust) {
        const y = p.y * height
        const band = .92 - p.y * .39 + p.spread
        const x = (band + Math.sin(t * .045 + p.phase) * .015 * p.depth) * width
        const driftY = Math.cos(t * .05 + p.phase) * 14 * p.depth
        ctx.globalAlpha = (.025 + p.depth * .08) * (.8 + Math.sin(t * .4 + p.phase) * .2)
        ctx.fillStyle = p.gold ? '#c7b28a' : '#8caeba'
        const size = .35 + p.depth * .8
        ctx.fillRect(x, y + driftY, size, size)
      }
      for (const star of stars) {
        const x = ((star.x + t * .0007 * star.depth) % 1) * width
        const y = (star.y + Math.sin(t * .025 + star.phase) * .008) * height
        ctx.globalAlpha = (.06 + star.depth * .17) * (.8 + Math.sin(t * .5 + star.phase) * .2)
        ctx.fillStyle = '#efe4cb'; ctx.beginPath(); ctx.arc(x, y, .35 + star.depth * .55, 0, Math.PI * 2); ctx.fill()
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
      const shade = ctx.createLinearGradient(0, 0, width, 0)
      shade.addColorStop(0, 'rgba(7,8,9,.3)'); shade.addColorStop(.6, 'rgba(7,8,9,.06)'); shade.addColorStop(1, 'rgba(7,8,9,.02)')
      ctx.fillStyle = shade; ctx.fillRect(0, 0, width, height)
    }
    const tick = (now: number) => {
      if (now - previous >= 33) { elapsed += Math.min((now - previous) / 1000, .05); previous = now; draw() }
      frame = requestAnimationFrame(tick)
    }
    const start = () => {
      cancelAnimationFrame(frame); previous = performance.now()
      if (!document.hidden && !motion.matches) frame = requestAnimationFrame(tick)
      else draw()
    }
    const onResize = () => { resize(); draw() }
    photograph.onload = draw
    resize(); draw(); start()
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', start)
    motion.addEventListener('change', start)
    return () => { photograph.onload = null; cancelAnimationFrame(frame); window.removeEventListener('resize', onResize); document.removeEventListener('visibilitychange', start); motion.removeEventListener('change', start) }
  }, [])
  return <canvas ref={ref} className="living-background" aria-hidden="true" />
}
