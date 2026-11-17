import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Lightformer, RoundedBox } from '@react-three/drei'
import * as THREE from 'three'

export type CardInfo = { balance: string | null; address: string | null; name: string | null }

const W = 3.4
const H = W / 1.586
const D = 0.14
const R = 0.07

/** The card number is the wallet address: dots, then its last four. */
export const cardNumber = (address: string | null) => address ?? 'No wallet yet'

/** Draws the card's face: Pact, the chip, the balance, the wallet number and the holder's name. */
function drawFace(info: CardInfo) {
  const c = document.createElement('canvas')
  c.width = 2048; c.height = Math.round(2048 / 1.586)
  const g = c.getContext('2d')!
  const s = c.width / 1000
  const font = (w: number, px: number) => `${w} ${px * s}px -apple-system, BlinkMacSystemFont, 'SF Pro Display', Inter, system-ui, sans-serif`
  // Brushed graphite, with a soft glow top-left and a faint holographic band, clipped to the card's rounded corners.
  g.beginPath(); g.roundRect(0, 0, c.width, c.height, (R / W) * c.width); g.clip()
  const base = g.createLinearGradient(0, 0, c.width, c.height)
  base.addColorStop(0, '#24262d'); base.addColorStop(0.5, '#0c0d10'); base.addColorStop(1, '#1b1c21')
  g.fillStyle = base; g.fillRect(0, 0, c.width, c.height)
  const glow = g.createRadialGradient(c.width * 0.15, 0, 0, c.width * 0.15, 0, c.width * 0.7)
  glow.addColorStop(0, 'rgba(150,170,220,0.22)'); glow.addColorStop(1, 'rgba(150,170,220,0)')
  g.fillStyle = glow; g.fillRect(0, 0, c.width, c.height)
  const holo = g.createLinearGradient(c.width * 0.55, 0, c.width, c.height)
  holo.addColorStop(0, 'rgba(255,255,255,0)'); holo.addColorStop(0.45, 'rgba(180,200,255,0.07)'); holo.addColorStop(0.55, 'rgba(255,220,200,0.07)'); holo.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = holo; g.fillRect(0, 0, c.width, c.height)
  for (let y = 0; y < c.height; y += 3) { g.fillStyle = `rgba(255,255,255,${0.008 + 0.006 * Math.sin(y * 0.7)})`; g.fillRect(0, y, c.width, 1) }

  const silver = g.createLinearGradient(0, 0, c.width, c.height)
  silver.addColorStop(0, '#ffffff'); silver.addColorStop(0.5, '#d6d8de'); silver.addColorStop(1, '#9ea1aa')

  // Brand
  g.fillStyle = silver
  g.font = font(800, 40)
  g.letterSpacing = `${8 * s}px`
  g.fillText('PACT', 60 * s, 92 * s)
  g.letterSpacing = '0px'
  g.font = font(600, 22)
  g.fillStyle = 'rgba(255,255,255,0.55)'
  g.textAlign = 'right'
  g.fillText('ARC TESTNET', 940 * s, 88 * s)
  g.textAlign = 'left'

  // Balance
  g.fillStyle = 'rgba(255,255,255,0.55)'
  g.font = font(600, 22)
  g.fillText('BALANCE', 60 * s, 214 * s)
  g.fillStyle = silver
  g.font = font(800, 104)
  const amount = info.balance ?? '0.00'
  g.fillText(amount, 54 * s, 318 * s)
  const w = g.measureText(amount).width
  g.font = font(700, 40)
  g.fillStyle = 'rgba(255,255,255,0.7)'
  g.fillText('USDC', 54 * s + w + 18 * s, 318 * s)

  // Number, from the wallet address
  g.fillStyle = 'rgba(255,255,255,0.5)'
  g.font = font(600, 18)
  g.fillText('WALLET ADDRESS', 60 * s, 420 * s)
  g.fillStyle = '#ffffff'
  const number = cardNumber(info.address)
  let px = 34
  g.font = `600 ${px * s}px 'SF Mono', ui-monospace, Menlo, monospace`
  while (g.measureText(number).width > 880 * s && px > 18) { px -= 1; g.font = `600 ${px * s}px 'SF Mono', ui-monospace, Menlo, monospace` }
  g.fillText(number, 60 * s, 470 * s)

  // Holder
  g.fillStyle = 'rgba(255,255,255,0.5)'
  g.font = font(600, 18)
  g.fillText('CARD HOLDER', 60 * s, 556 * s)
  g.fillStyle = '#ffffff'
  g.font = font(700, 30)
  g.fillText((info.name ?? 'You').toUpperCase(), 60 * s, 592 * s)

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 16
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  return tex
}

function Card({ info }: { info: CardInfo }) {
  const group = useRef<THREE.Group>(null)
  const face = useMemo(() => drawFace(info), [info.balance, info.address, info.name])
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
    const targetY = state.pointer.x * 0.3 + Math.sin(t * 0.45) * 0.04 + (1 - ease) * -1.6
    const targetX = -state.pointer.y * 0.22 + Math.cos(t * 0.4) * 0.03
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, targetY, 2.4, delta)
    g.rotation.x = THREE.MathUtils.damp(g.rotation.x, targetX, 2.4, delta)
    g.position.y = Math.sin(t * 0.7) * 0.03
    // Shrink to fit narrow screens, with room for the tilt.
    const fit = Math.min(1, (state.viewport.width * 0.94) / W)
    g.scale.setScalar((0.85 + 0.15 * ease) * fit)
  })

  return (
    <group ref={group}>
      <RoundedBox args={[W, H, D]} radius={R} smoothness={10}>
        <meshPhysicalMaterial color="#3a3c44" metalness={1} roughness={0.22} clearcoat={1} clearcoatRoughness={0.1} envMapIntensity={1.3} />
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
      <div className="l-flatcard-top"><b>PACT</b><span>ARC TESTNET</span></div>
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

export function BankCard({ info, footer }: { info: CardInfo; footer?: ReactNode }) {
  return (
    <div className="l-bankcard">
      <Fallback fallback={<FlatCard info={info} />}>
        <div className="l-bankcard-stage">
        <Canvas dpr={[2, 3]} camera={{ position: [0, 0, 4.0], fov: 34 }} gl={{ antialias: true, alpha: true }} aria-label={`Wallet card, balance ${info.balance ?? '0.00'} USDC`}>
          <ambientLight intensity={0.35} />
          <directionalLight position={[3, 4, 5]} intensity={1.2} />
          <Suspense fallback={null}>
            <Environment resolution={256}>
              <Lightformer form="rect" intensity={1.1} position={[0, 4, 5]} scale={[6, 1.2, 1]} />
              <Lightformer form="rect" intensity={1.6} position={[-5, 0, 2]} rotation-y={Math.PI / 2} scale={[8, 4, 1]} color="#b9c6ff" />
              <Lightformer form="rect" intensity={1.2} position={[5, -1, 2]} rotation-y={-Math.PI / 2} scale={[8, 4, 1]} color="#ffe1c4" />
              <Lightformer form="ring" intensity={2} position={[0, 0, -6]} scale={6} />
            </Environment>
            <Card info={info} />
          </Suspense>
        </Canvas>
        </div>
      </Fallback>
      {footer}
    </div>
  )
}
