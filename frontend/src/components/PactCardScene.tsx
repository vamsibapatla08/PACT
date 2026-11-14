import { Component, Suspense, useMemo, useRef, type ReactNode } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import { useReducedMotion } from 'motion/react'
import * as THREE from 'three'

function Gold() {
  return <meshStandardMaterial color="#d9b86e" metalness={.92} roughness={.24} envMapIntensity={1.6} />
}

function Rod({ from, to }: { from: THREE.Vector3; to: THREE.Vector3 }) {
  const midpoint = from.clone().add(to).multiplyScalar(.5)
  const direction = to.clone().sub(from)
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize())
  return <mesh position={midpoint} quaternion={quaternion}><cylinderGeometry args={[.012, .012, direction.length(), 6]} /><Gold /></mesh>
}

function Sculpture({ variant, still }: { variant: number; still: boolean }) {
  const body = useRef<THREE.Group>(null)
  const rings = useRef<THREE.Group>(null)
  const subject = useRef<THREE.Group>(null)
  const curve = useMemo(() => new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, i) => new THREE.Vector3(-.65 + i * .16, -.4 + i * .09 + Math.sin(i * 1.6) * .13, 0))), [])
  const nodes = useMemo(() => Array.from({ length: 9 }, (_, i) => new THREE.Vector3(Math.cos(i * 2.4) * .63, Math.sin(i * 2.4) * .58, Math.sin(i * 1.7) * .48)), [])
  useFrame(({ clock }, delta) => {
    if (still) return
    const t = clock.elapsedTime + variant * 2
    if (body.current) { body.current.position.y = Math.sin(t * .6) * .055; body.current.rotation.y = Math.sin(t * .3) * .18 }
    if (rings.current) { rings.current.rotation.y += Math.min(delta, .05) * .24; rings.current.rotation.z = Math.sin(t * .22) * .18 }
    if (subject.current) subject.current.rotation.y = variant === 1 ? t * .2 : Math.sin(t * .38) * .35
  })
  return <group ref={body} rotation={[.1, -.2, 0]} scale={.93}>
    <mesh><sphereGeometry args={[.91, 40, 24]} /><meshPhysicalMaterial color="#8b7950" metalness={.2} roughness={.12} transparent opacity={.1} depthWrite={false} side={THREE.FrontSide} clearcoat={1} /></mesh>
    <group ref={rings}>
      {[0, 1, 2].map(i => <mesh key={i} rotation={[.5 + i * .65, i * .82, i * .36]}><torusGeometry args={[1 + i * .035, .012, 8, 96]} /><Gold /></mesh>)}
      <mesh position={[0, 1.05, 0]}><sphereGeometry args={[.045, 12, 8]} /><Gold /></mesh>
    </group>
    <group ref={subject}>
      {variant === 0 && Array.from({ length: 5 }, (_, i) => <mesh key={i} position={[-.56 + i * .27, -.5 + (.22 + i * .19) / 2, 0]}><boxGeometry args={[.17, .22 + i * .19, .22]} /><Gold /></mesh>)}
      {variant === 1 && <>{nodes.map((p, i) => <mesh key={i} position={p}><sphereGeometry args={[i === 4 ? .12 : .065, 16, 12]} /><Gold /></mesh>)}{nodes.map((p, i) => <Rod key={i} from={p} to={nodes[(i + 3) % nodes.length]} />)}</>}
      {variant >= 2 && <><mesh><tubeGeometry args={[curve, 50, variant === 2 ? .04 : .026, 10, false]} /><Gold /></mesh>{variant === 3 && Array.from({ length: 8 }, (_, i) => <mesh key={i} position={[-.65 + i * .16, -.5 + (i * .085 + .14) / 2, -.06]}><boxGeometry args={[.12, i * .085 + .14, .12]} /><meshPhysicalMaterial color="#648b98" metalness={.55} roughness={.2} clearcoat={1} /></mesh>)}</>}
      <mesh position={[0, -.58, 0]}><cylinderGeometry args={[.76, .8, .045, 48]} /><Gold /></mesh>
    </group>
  </group>
}

export function PactCardArt({ variant }: { variant: number }) {
  const still = Boolean(useReducedMotion())
  return <div className="pact-live-art" aria-hidden="true">
    <Canvas className="pact-card-canvas" dpr={[1, 1.4]} camera={{ position: [0, 0, 4], fov: 38 }} gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}>
      <Suspense fallback={null}>
        <ambientLight intensity={1.1} color="#ffe8be" />
        <directionalLight position={[3, 4, 5]} intensity={3.5} color="#fff0d0" />
        <directionalLight position={[-4, 1, -2]} intensity={2.5} color="#b6cfdf" />
        <Environment resolution={32} frames={1}>
          <Lightformer position={[-2, 3, 4]} intensity={4} scale={[3, 5, 1]} color="#ffedcb" />
          <Lightformer position={[3, 0, 2]} intensity={3} scale={[2, 4, 1]} color="#b8d4e1" />
        </Environment>
        <Sculpture variant={variant} still={still} />
      </Suspense>
    </Canvas>
  </div>
}

export class PactArtBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? null : this.props.children }
}

