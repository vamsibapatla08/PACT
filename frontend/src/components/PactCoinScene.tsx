import { Component, Suspense, useMemo, useRef, type ErrorInfo, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, Sparkles } from '@react-three/drei'
import { faDollarSign } from '@fortawesome/free-solid-svg-icons'
import * as THREE from 'three'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import { SceneFallback } from './SceneFallback'

function GoldMaterial({ roughness = 0.22 }: { roughness?: number }) {
  return <meshPhysicalMaterial color="#e0b55c" metalness={1} roughness={roughness} clearcoat={0.2} clearcoatRoughness={0.22} envMapIntensity={1.85} emissive="#76501a" emissiveIntensity={0.34} />
}

function ConnectionRings() {
  const group = useRef<THREE.Group>(null)
  const phase = useRef(0)

  useFrame((_, delta) => {
    if (!group.current) return
    // A backgrounded tab can resume with a very large delta. Advancing with a
    // bounded step prevents the rings from visibly snapping to a new angle.
    phase.current += Math.min(delta, 1 / 30)
    group.current.rotation.z = phase.current * 0.035
    group.current.rotation.y = Math.sin(phase.current * 0.18) * 0.14
  })
  return (
    <group ref={group} position={[0.25, 0, -1.8]} rotation={[1.05, 0.25, -0.25]}>
      <mesh><torusGeometry args={[1.55, 0.014, 12, 160]} /><meshStandardMaterial color="#d1a554" metalness={1} roughness={0.3} emissive="#5d3b0e" emissiveIntensity={0.2} transparent opacity={0.68} /></mesh>
      <mesh rotation={[0.45, 0.8, 0.1]}><torusGeometry args={[1.9, 0.01, 12, 160]} /><meshStandardMaterial color="#b28743" metalness={1} roughness={0.35} emissive="#4d300b" emissiveIntensity={0.18} transparent opacity={0.42} /></mesh>
    </group>
  )
}

function DollarEmblem({ back = false }: { back?: boolean }) {
  const geometry = useMemo(() => {
    const [width, height, , , rawPath] = faDollarSign.icon
    const pathData = Array.isArray(rawPath) ? rawPath.join(' ') : rawPath
    const parsed = new SVGLoader().parse(`<svg viewBox="0 0 ${width} ${height}"><path d="${pathData}"/></svg>`)
    const shapes = parsed.paths.flatMap((path) => SVGLoader.createShapes(path))
    const extruded = new THREE.ExtrudeGeometry(shapes, {
      depth: 0.18,
      curveSegments: 18,
      bevelEnabled: true,
      bevelThickness: 0.045,
      bevelSize: 6,
      bevelOffset: 0,
      bevelSegments: 6,
    })
    extruded.scale(0.0028, -0.0028, 1)
    extruded.center()
    extruded.computeVertexNormals()
    return extruded
  }, [])

  return (
    <group position={[0, 0, back ? -0.27 : 0.27]} rotation={[0, back ? Math.PI : 0, 0]} scale={1.04}>
      <mesh geometry={geometry} position={[0.025, -0.03, -0.045]} scale={1.025}>
        <meshStandardMaterial color="#6c4b18" metalness={0.92} roughness={0.34} envMapIntensity={1} transparent={false} depthWrite />
      </mesh>
      <mesh geometry={geometry} castShadow>
        <meshPhysicalMaterial color="#e8bd63" metalness={1} roughness={0.17} clearcoat={0.32} clearcoatRoughness={0.18} envMapIntensity={1.95} emissive="#75501b" emissiveIntensity={0.3} transparent={false} opacity={1} depthWrite side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

function PactCoin() {
  const coin = useRef<THREE.Group>(null)
  const phase = useRef(0)
  const { pointer } = useThree()
  const target = useMemo(() => new THREE.Vector2(), [])

  useFrame((_, delta) => {
    if (!coin.current) return
    const stableDelta = Math.min(delta, 1 / 30)
    phase.current += stableDelta
    target.set(pointer.y * 0.12, pointer.x * 0.2)
    coin.current.rotation.x = THREE.MathUtils.damp(coin.current.rotation.x, 0.08 + target.x, 2.6, stableDelta)
    coin.current.rotation.y += stableDelta * 0.18
    coin.current.rotation.z = THREE.MathUtils.damp(coin.current.rotation.z, -0.06 + target.y * 0.15, 2.4, stableDelta)
    coin.current.position.y = Math.sin(phase.current * 0.65) * 0.1
  })

  return (
    <group ref={coin} position={[0.55, -0.15, 0]} scale={0.725} rotation={[0.08, -0.28, -0.06]}>
      <mesh castShadow receiveShadow rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[1.45, 1.45, 0.3, 128, 4]} /><GoldMaterial roughness={0.24} /></mesh>
      {Array.from({ length: 46 }).map((_, index) => {
        const angle = (index / 46) * Math.PI * 2
        return <mesh key={index} position={[Math.cos(angle) * 1.462, Math.sin(angle) * 1.462, 0]} rotation={[0, 0, angle]}><boxGeometry args={[0.055, 0.13, 0.32]} /><meshStandardMaterial color={index % 2 ? '#b7883b' : '#edc970'} metalness={1} roughness={0.3} envMapIntensity={1.6} emissive="#674311" emissiveIntensity={0.28} /></mesh>
      })}
      <mesh position={[0, 0, 0.158]}><circleGeometry args={[1.33, 128]} /><meshPhysicalMaterial color="#242529" metalness={0.82} roughness={0.28} clearcoat={0.16} clearcoatRoughness={0.28} envMapIntensity={1.2} emissive="#101012" emissiveIntensity={0.22} /></mesh>
      <mesh position={[0, 0, 0.17]}><ringGeometry args={[1.08, 1.19, 128]} /><GoldMaterial roughness={0.28} /></mesh>
      <DollarEmblem />
      <mesh position={[0, 0, -0.158]} rotation={[0, Math.PI, 0]}><circleGeometry args={[1.33, 128]} /><meshPhysicalMaterial color="#242529" metalness={0.82} roughness={0.28} clearcoat={0.16} clearcoatRoughness={0.28} envMapIntensity={1.2} emissive="#101012" emissiveIntensity={0.22} /></mesh>
      <mesh position={[0, 0, -0.174]} rotation={[0, Math.PI, 0]}><ringGeometry args={[0.45, 1.05, 96]} /><GoldMaterial roughness={0.34} /></mesh>
      <DollarEmblem back />
    </group>
  )
}

function Scene() {
  return (
    <>
      <fog attach="fog" args={['#070809', 7, 15]} />
      <ambientLight intensity={0.95} color="#ffe8bb" />
      <hemisphereLight args={['#fff0c9', '#8a5d23', 2.8]} />
      <spotLight position={[-3, 5, 5]} angle={0.38} penumbra={0.8} intensity={95} color="#ffd88c" castShadow />
      <spotLight position={[4, 1, 4]} angle={0.45} penumbra={0.9} intensity={62} color="#e4e8ef" />
      <spotLight position={[1, 2, -5]} angle={0.55} penumbra={0.85} intensity={110} color="#ffd58a" />
      <pointLight position={[0, -3, 2]} intensity={25} color="#8d6429" />
      <pointLight position={[0, 1, -3]} intensity={58} color="#e4b75e" />
      <pointLight position={[0, 0, 4]} intensity={45} color="#ffe4a5" />
      <Environment resolution={128} environmentIntensity={0.48}>
        <Lightformer form="rect" intensity={5} color="#ffe6b0" position={[-3, 4, 3]} scale={[5, 2, 1]} rotation={[0, 0.35, 0]} />
        <Lightformer form="rect" intensity={3} color="#d9e1ee" position={[4, 1, 2]} scale={[2, 4, 1]} rotation={[0, -0.55, 0]} />
        <Lightformer form="ring" intensity={2} color="#a97b35" position={[0, -4, 1]} scale={2.5} />
      </Environment>
      <PactCoin />
      <ConnectionRings />
      <Sparkles count={26} scale={[7, 5, 4]} size={1} speed={0.05} opacity={0.4} color="#f0cd7c" />
    </>
  )
}

class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('WebGL scene unavailable', error, info) }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

export function PactCoinScene() {
  return (
    <SceneBoundary fallback={<SceneFallback />}>
      <Canvas
        className="coin-canvas"
        dpr={[1, 1.35]}
        camera={{ position: [0, 0, 6.4], fov: 40 }}
        gl={{ antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance', stencil: false }}
        resize={{ scroll: false, debounce: { scroll: 100, resize: 100 } }}
        fallback={<SceneFallback />}
      >
        <Suspense fallback={null}><Scene /></Suspense>
      </Canvas>
    </SceneBoundary>
  )
}
