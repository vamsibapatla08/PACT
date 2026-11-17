import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Lightformer, RoundedBox } from '@react-three/drei'
import * as THREE from 'three'

export type CardInfo = { balance: string | null; address: string | null; name: string | null }

const W = 3.4
const H = W / 1.586
const D = 0.14
const R = 0.07
// The canvas is bigger than the card's slot on every side, so a tilted corner is never cut off.
const BLEED_X = 0.18
const BLEED_Y = 0.3

/** The card number is the wallet address: dots, then its last four. */
export const cardNumber = (address: string | null) => address ?? 'No wallet yet'

// ---- Finishes: the card's metal. Grey is the default, and the only one outside the signed-in app.

export type FinishId = 'grey' | 'graphite' | 'titanium' | 'champagne' | 'gold' | 'liquid'
type Finish = { id: FinishId; name: string; stops: string[]; ink: string; soft: string; emboss: string; edge: string; swatch: string; liquid?: boolean }

export const FINISHES: Finish[] = [
  { id: 'grey', name: 'Grey', stops: ['#e9ebef', '#c3c7cf', '#eef0f3', '#a9adb6', '#cfd2d8'], ink: '#1d1f25', soft: 'rgba(29,31,37,0.55)', emboss: 'rgba(255,255,255,0.55)', edge: '#c9ccd3',
    swatch: 'linear-gradient(135deg, #f4f5f7, #b9bdc5 50%, #e6e8eb)' },
  { id: 'graphite', name: 'Graphite', stops: ['#5d616a', '#373a41', '#6c7079', '#2a2d33', '#4b4f57'], ink: '#f3f4f6', soft: 'rgba(243,244,246,0.6)', emboss: 'rgba(0,0,0,0.45)', edge: '#4a4e56',
    swatch: 'linear-gradient(135deg, #767a83, #2c2f35 55%, #5a5e66)' },
  { id: 'titanium', name: 'Titanium', stops: ['#bfc2c8', '#8b8f98', '#cdd0d5', '#767a83', '#a5a9b1'], ink: '#15171c', soft: 'rgba(21,23,28,0.55)', emboss: 'rgba(255,255,255,0.4)', edge: '#9a9ea6',
    swatch: 'linear-gradient(135deg, #d3d6db, #7d818a 55%, #b3b6bd)' },
  { id: 'champagne', name: 'Champagne', stops: ['#f6eedc', '#d9c8a2', '#f8f1e2', '#bca46f', '#e3d5b4'], ink: '#2a2218', soft: 'rgba(42,34,24,0.55)', emboss: 'rgba(255,255,255,0.5)', edge: '#d6c49c',
    swatch: 'linear-gradient(135deg, #faf3e4, #c9b27f 55%, #ecdfc2)' },
  { id: 'gold', name: 'Gold', stops: ['#f8e4a8', '#d3a64a', '#f7dd95', '#a5772a', '#e1bd66'], ink: '#2a1c06', soft: 'rgba(42,28,6,0.6)', emboss: 'rgba(255,240,200,0.5)', edge: '#d0a24a',
    swatch: 'linear-gradient(135deg, #fbe9b4, #c4952f 55%, #f0cf7c)' },
  { id: 'liquid', name: 'Liquid gold', stops: [], ink: '#1c1408', soft: 'rgba(28,20,8,0.6)', emboss: 'rgba(255,245,220,0.5)', edge: '#cdb27a', liquid: true,
    swatch: 'radial-gradient(circle at 30% 30%, #fff4d6, #d8b36a 35%, #8d8f96 70%, #e9d29b)' },
]
export const finishOf = (id: string | null | undefined) => FINISHES.find((f) => f.id === id) ?? FINISHES[0]

// Value noise and the same folded-metal surface as the app's LiquidGold background, painted once on the CPU.
function hash(x: number, y: number) { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h) }
function noise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy)
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}
function fbm(x: number, y: number) { let v = 0, amp = 0.5; for (let i = 0; i < 4; i++) { v += amp * noise(x, y); x = x * 2.02 + 1.3; y = y * 2.02 + 7.1; amp *= 0.5 } return v }
function surface(x: number, y: number) {
  const qx = fbm(x, y), qy = fbm(x + 5.2, y + 1.3)
  const rx = fbm(x + 1.6 * qx + 1.7, y + 1.6 * qy + 9.2), ry = fbm(x + 1.6 * qx + 8.3, y + 1.6 * qy + 2.8)
  return fbm(x + 1.4 * rx, y + 1.4 * ry)
}

/** Liquid gold: poured metal, gold pooling in the folds and silver on the crests, lit from the top left. */
function paintLiquid(g: CanvasRenderingContext2D, width: number, height: number) {
  const w = 340, h = Math.round(340 / 1.586)
  const small = document.createElement('canvas'); small.width = w; small.height = h
  const sg = small.getContext('2d')!
  const img = sg.createImageData(w, h)
  const L = [-0.4, 0.6, 0.7], ln = Math.hypot(...L)
  const e = 0.012
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = (i / w) * 1.9 + 0.4, y = (j / h) * 1.2 + 0.2
    const s0 = surface(x, y)
    let nx = surface(x + e, y) - s0, ny = surface(x, y + e) - s0, nz = e * 0.9
    const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl
    const diff = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / ln)
    const rz = 2 * diff * nz - L[2] / ln
    const spec = Math.pow(Math.max(0, rz), 10) * 0.7
    const rim = Math.pow(1 - Math.max(0, nz), 2)
    // This surface stays between about 0.56 and 0.64, so stretch that to the whole grey-to-gold range.
    const v = Math.min(1, Math.max(0, (s0 + 0.18 * Math.sin(s0 * 5) - 0.565) / 0.07))
    const t = 0.05 + 0.9 * v * v * (3 - 2 * v)
    const base = [0.80 + (1.0 - 0.80) * t, 0.80 + (0.84 - 0.80) * t, 0.82 + (0.58 - 0.82) * t]
    const lit = 0.55 + 0.45 * diff
    const k = (j * w + i) * 4
    for (let c = 0; c < 3; c++) {
      const v = 0.28 + (base[c] - 0.28) * lit + spec * [1, 0.95, 0.85][c] + rim * [1, 0.86, 0.62][c] * 0.3
      img.data[k + c] = Math.min(255, v * 255)
    }
    img.data[k + 3] = 255
  }
  sg.putImageData(img, 0, 0)
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'
  g.drawImage(small, 0, 0, width, height)
}

/** A made-up EMV chip: gold, with the usual contact lines. Decoration only. */
function drawChip(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s: number) {
  const gold = g.createLinearGradient(x, y, x + w, y + h)
  gold.addColorStop(0, '#f6e3a1'); gold.addColorStop(0.35, '#d8b45c'); gold.addColorStop(0.65, '#f2d98c'); gold.addColorStop(1, '#a8833a')
  g.fillStyle = gold
  g.beginPath(); g.roundRect(x, y, w, h, 14 * s); g.fill()
  g.strokeStyle = 'rgba(90, 64, 20, 0.55)'; g.lineWidth = 2.2 * s
  g.beginPath()
  g.moveTo(x + w * 0.34, y); g.lineTo(x + w * 0.34, y + h)
  g.moveTo(x + w * 0.66, y); g.lineTo(x + w * 0.66, y + h)
  g.moveTo(x, y + h * 0.36); g.lineTo(x + w * 0.34, y + h * 0.36)
  g.moveTo(x, y + h * 0.64); g.lineTo(x + w * 0.34, y + h * 0.64)
  g.moveTo(x + w * 0.66, y + h * 0.36); g.lineTo(x + w, y + h * 0.36)
  g.moveTo(x + w * 0.66, y + h * 0.64); g.lineTo(x + w, y + h * 0.64)
  g.stroke()
  g.beginPath(); g.roundRect(x + w * 0.34, y + h * 0.28, w * 0.32, h * 0.44, 6 * s); g.stroke()
  const shine = g.createLinearGradient(x, y, x, y + h)
  shine.addColorStop(0, 'rgba(255,255,255,0.45)'); shine.addColorStop(0.5, 'rgba(255,255,255,0)')
  g.fillStyle = shine
  g.beginPath(); g.roundRect(x, y, w, h, 14 * s); g.fill()
}

/** Draws the card's face: brushed silver metal, Pact Money, the chip, the balance, the wallet and the holder's name. */
function drawFace(info: CardInfo, finish: Finish) {
  const c = document.createElement('canvas')
  c.width = 2048; c.height = Math.round(2048 / 1.586)
  const g = c.getContext('2d')!
  const s = c.width / 1000
  const font = (w: number, px: number) => `${w} ${px * s}px -apple-system, BlinkMacSystemFont, 'SF Pro Display', Inter, system-ui, sans-serif`
  g.beginPath(); g.roundRect(0, 0, c.width, c.height, (R / W) * c.width); g.clip()
  if (finish.liquid) paintLiquid(g, c.width, c.height)
  else {
    // Brushed metal: the finish's base, fine horizontal brush strokes, and a soft diagonal sheen.
    const base = g.createLinearGradient(0, 0, c.width, c.height)
    finish.stops.forEach((color, i) => base.addColorStop(i / (finish.stops.length - 1), color))
    g.fillStyle = base; g.fillRect(0, 0, c.width, c.height)
    for (let y = 0; y < c.height; y += 2) {
      const a = 0.025 + 0.03 * Math.abs(Math.sin(y * 12.9898) * 43758.5453 % 1)
      g.fillStyle = y % 4 ? `rgba(255,255,255,${a})` : `rgba(40,44,52,${a * 0.8})`
      g.fillRect(0, y, c.width, 1)
    }
  }
  const sheen = g.createLinearGradient(c.width * 0.2, 0, c.width * 0.75, c.height)
  sheen.addColorStop(0, 'rgba(255,255,255,0)'); sheen.addColorStop(0.48, 'rgba(255,255,255,0.3)'); sheen.addColorStop(0.52, 'rgba(255,255,255,0.3)'); sheen.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = sheen; g.fillRect(0, 0, c.width, c.height)

  // Ink, with a line just under each letter so it reads as pressed into the metal.
  const { ink, soft } = finish
  const text = (t: string, x: number, y: number, color: string) => {
    g.fillStyle = finish.emboss; g.fillText(t, x, y + 1.6 * s)
    g.fillStyle = color; g.fillText(t, x, y)
  }

  // Brand
  g.font = font(800, 38)
  g.letterSpacing = `${7 * s}px`
  text('PACT MONEY', 60 * s, 92 * s, ink)
  g.letterSpacing = '0px'
  g.font = font(700, 20)
  g.textAlign = 'right'
  text('BASE SEPOLIA', 940 * s, 88 * s, soft)
  g.textAlign = 'left'

  drawChip(g, 60 * s, 132 * s, 120 * s, 92 * s, s)

  // Balance
  g.font = font(700, 20)
  text('BALANCE', 60 * s, 284 * s, soft)
  g.font = font(800, 96)
  const amount = info.balance ?? '0.00'
  text(amount, 54 * s, 376 * s, ink)
  const w = g.measureText(amount).width
  g.font = font(700, 36)
  text('USDC', 54 * s + w + 18 * s, 376 * s, soft)

  // Number, from the wallet address
  g.font = font(700, 17)
  text('WALLET ADDRESS', 60 * s, 444 * s, soft)
  const number = cardNumber(info.address)
  let px = 32
  g.font = `600 ${px * s}px 'SF Mono', ui-monospace, Menlo, monospace`
  while (g.measureText(number).width > 880 * s && px > 18) { px -= 1; g.font = `600 ${px * s}px 'SF Mono', ui-monospace, Menlo, monospace` }
  text(number, 60 * s, 490 * s, ink)

  // Holder
  g.font = font(700, 17)
  text('CARD HOLDER', 60 * s, 556 * s, soft)
  g.font = font(700, 30)
  text((info.name ?? 'You').toUpperCase(), 60 * s, 594 * s, ink)

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 16
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  return tex
}

function Card({ info, finish }: { info: CardInfo; finish: Finish }) {
  const group = useRef<THREE.Group>(null)
  const face = useMemo(() => drawFace(info, finish), [info.balance, info.address, info.name, finish])
  useEffect(() => () => face.dispose(), [face])
  const born = useRef<number | null>(null)

  useFrame((state, delta) => {
    const g = group.current
    if (!g) return
    const t = state.clock.elapsedTime
    if (born.current === null) born.current = t
    // A spin in when it first appears, then a slow float, tilting toward the pointer.
    const intro = Math.min(1, (t - born.current) / 1.9)
    const ease = 1 - Math.pow(1 - intro, 3)
    const px = THREE.MathUtils.clamp(state.pointer.x, -1, 1)
    const py = THREE.MathUtils.clamp(state.pointer.y, -1, 1)
    const targetY = px * 0.3 + Math.sin(t * 0.45) * 0.04 + (1 - ease) * -1.6
    const targetX = -py * 0.22 + Math.cos(t * 0.4) * 0.03
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, targetY, 2.4, delta)
    g.rotation.x = THREE.MathUtils.damp(g.rotation.x, targetX, 2.4, delta)
    g.position.y = Math.sin(t * 0.7) * 0.03
    // Fit the card to its slot (the canvas minus the bleed), so it shrinks on narrow screens.
    const slotW = state.viewport.width / (1 + 2 * BLEED_X)
    const slotH = state.viewport.height / (1 + 2 * BLEED_Y)
    const fit = Math.min(1, (slotW * 0.96) / W, (slotH * 0.96) / H)
    g.scale.setScalar((0.85 + 0.15 * ease) * fit)
  })

  return (
    <group ref={group}>
      <RoundedBox args={[W, H, D]} radius={R} smoothness={10}>
        <meshPhysicalMaterial color={finish.edge} metalness={1} roughness={0.26} clearcoat={1} clearcoatRoughness={0.12} envMapIntensity={1.4} />
      </RoundedBox>
      <mesh position={[0, 0, D / 2 + 0.001]}>
        <planeGeometry args={[W, H]} />
        <meshBasicMaterial map={face} transparent toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, D / 2 + 0.002]}>
        <planeGeometry args={[W, H]} />
        <meshPhysicalMaterial color="#ffffff" transparent opacity={0.035} metalness={1} roughness={0.12} envMapIntensity={2.2} depthWrite={false} />
      </mesh>
    </group>
  )
}

/** Shown when the browser can't do WebGL: the same card, flat. */
function FlatCard({ info }: { info: CardInfo }) {
  return (
    <div className="l-flatcard">
      <div className="l-flatcard-top"><b>PACT MONEY</b><span>BASE SEPOLIA</span></div>
      <span className="l-flatcard-chip" aria-hidden />
      <span className="l-faint">BALANCE</span>
      <div className="l-flatcard-bal">{info.balance ?? '0.00'} <small>USDC</small></div>
      <div className="l-flatcard-num">{cardNumber(info.address)}</div>
      <span className="l-faint">{(info.name ?? 'You').toUpperCase()}</span>
    </div>
  )
}

class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

/** The card. `finish`: 'grey' always (the landing page), 'saved' shows the finish picked in the Wallet (Home),
 *  'pick' shows it with the swatches to change it (the Wallet). */
export function BankCard({ info, footer, finish: mode = 'grey' }: { info: CardInfo; footer?: ReactNode; finish?: 'grey' | 'saved' | 'pick' }) {
  const [saved, setSaved] = useCardFinish()
  const finish = mode === 'grey' ? FINISHES[0] : saved
  const pickable = mode === 'pick'
  // The pointer is read from the slot, while the oversized canvas lets clicks pass through to whatever is around it.
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  return (
    <div className="l-bankcard">
      <Fallback fallback={<FlatCard info={info} />}>
        <div className="l-bankcard-stage" ref={setSlot}>
        {slot && (
        <Canvas dpr={[2, 3]} camera={{ position: [0, 0, 4.0 * (1 + 2 * BLEED_Y)], fov: 34 }} gl={{ antialias: true, alpha: true }}
          eventSource={slot} eventPrefix="client"
          style={{ position: 'absolute', left: `${-BLEED_X * 100}%`, top: `${-BLEED_Y * 100}%`, width: `${(1 + 2 * BLEED_X) * 100}%`, height: `${(1 + 2 * BLEED_Y) * 100}%`, pointerEvents: 'none' }}
          aria-label={`Pact Money card, balance ${info.balance ?? '0.00'} USDC`}>
          <ambientLight intensity={0.45} />
          <directionalLight position={[3, 4, 5]} intensity={1.3} />
          <Suspense fallback={null}>
            <Environment resolution={256}>
              <Lightformer form="rect" intensity={1.1} position={[0, 4, 5]} scale={[6, 1.2, 1]} />
              <Lightformer form="rect" intensity={1.6} position={[-5, 0, 2]} rotation-y={Math.PI / 2} scale={[8, 4, 1]} color="#b9c6ff" />
              <Lightformer form="rect" intensity={1.2} position={[5, -1, 2]} rotation-y={-Math.PI / 2} scale={[8, 4, 1]} color="#ffe1c4" />
              <Lightformer form="ring" intensity={2} position={[0, 0, -6]} scale={6} />
            </Environment>
            <Card info={info} finish={finish} />
          </Suspense>
        </Canvas>
        )}
        </div>
      </Fallback>
      {pickable && (
        <div className="l-finishes" role="radiogroup" aria-label="Card finish">
          {FINISHES.map((f) => (
            <button key={f.id} type="button" role="radio" aria-checked={f.id === finish.id} aria-label={f.name} title={f.name}
              className={f.id === finish.id ? 'on' : ''} style={{ background: f.swatch }} onClick={() => setSaved(f.id)} />
          ))}
        </div>
      )}
      {footer}
    </div>
  )
}

// The finish is a per-device preference, kept in this browser. Home and Wallet share it live.
const FINISH_KEY = 'pact-card-finish'
function readFinish(): FinishId { try { return finishOf(localStorage.getItem(FINISH_KEY)).id } catch { return 'grey' } }
function useCardFinish(): [Finish, (id: FinishId) => void] {
  const [id, setId] = useState<FinishId>(readFinish)
  useEffect(() => {
    const on = () => setId(readFinish())
    addEventListener('pact-card-finish', on); addEventListener('storage', on)
    return () => { removeEventListener('pact-card-finish', on); removeEventListener('storage', on) }
  }, [])
  const set = (next: FinishId) => {
    try { localStorage.setItem(FINISH_KEY, next) } catch { /* private mode: it just won't be remembered */ }
    setId(next); dispatchEvent(new Event('pact-card-finish'))
  }
  return [useMemo(() => finishOf(id), [id]), set]
}
