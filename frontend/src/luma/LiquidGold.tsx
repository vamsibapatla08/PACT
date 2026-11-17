import { useEffect, useRef } from 'react'

// Liquid gold and silver, drawn by the GPU: folded noise gives the flowing metal, lit like chrome.
// Plain WebGL so it stays tiny; renders at low resolution and is kept faint behind everything.
const vertex = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`

const fragment = `
precision highp float;
uniform vec2 res;
uniform float t;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.5, 1.1, -1.1, 1.5);
  for (int i = 0; i < 3; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}
// The folded surface: noise warped by noise, flowing slowly.
float surface(vec2 p) {
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.035)), fbm(p + vec2(5.2, 1.3) - t * 0.03));
  vec2 r = vec2(fbm(p + 1.6 * q + vec2(1.7, 9.2) + t * 0.02), fbm(p + 1.6 * q + vec2(8.3, 2.8)));
  return fbm(p + 1.4 * r);
}

void main() {
  vec2 uv = gl_FragCoord.xy / res;
  vec2 p = (gl_FragCoord.xy - 0.5 * res) / res.y * 0.75 + vec2(0.0, 0.3);
  float h = surface(p);
  // Normal from the slope, so the folds catch light like poured metal.
  float e = 0.012;
  vec3 n = normalize(vec3(surface(p + vec2(e, 0)) - h, surface(p + vec2(0, e)) - h, e * 0.9));
  vec3 view = vec3(0, 0, 1);
  vec3 light = normalize(vec3(-0.4, 0.6, 0.7));
  float diff = clamp(dot(n, light), 0.0, 1.0);
  float spec = pow(clamp(dot(reflect(-light, n), view), 0.0, 1.0), 10.0) * 0.8;
  float rim = pow(1.0 - clamp(n.z, 0.0, 1.0), 2.0);

  vec3 silver = vec3(0.78, 0.78, 0.80);
  vec3 gold = vec3(1.0, 0.86, 0.62);
  vec3 deep = vec3(0.16, 0.14, 0.12);
  // Gold pools in the folds, silver on the crests.
  float goldness = smoothstep(0.3, 0.7, h + 0.18 * sin(h * 5.0 + t * 0.08));
  vec3 base = mix(silver, gold, 0.12 + 0.5 * goldness);
  vec3 col = mix(deep, base, 0.25 + 0.75 * diff) + spec * vec3(1.0, 0.95, 0.85) + rim * gold * 0.35;

  // Faint: brightest at the top, fading to near black lower down.
  // Mostly black: faint in the middle and upper part, falling off to black at every edge.
  float fade = mix(0.05, 0.22, smoothstep(0.05, 1.0, uv.y));
  vec2 c = (uv - vec2(0.5, 0.6)) * vec2(res.x / res.y * 0.9, 1.15);
  float vignette = smoothstep(0.95, 0.15, length(c));
  gl_FragColor = vec4(col * fade * vignette, 1.0);
}`

export function LiquidGold() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const gl = canvas?.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' })
    if (!canvas || !gl) return
    const compile = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s }
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vertex))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fragment))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return
    gl.useProgram(prog)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const uRes = gl.getUniformLocation(prog, 'res'), uT = gl.getUniformLocation(prog, 't')

    // Half resolution: it's soft and faint, so nobody sees the pixels, and it stays light on the GPU.
    const scale = 0.5
    const resize = () => {
      canvas.width = Math.max(1, Math.round(innerWidth * scale)); canvas.height = Math.max(1, Math.round(innerHeight * scale))
      gl.viewport(0, 0, canvas.width, canvas.height)
    }
    resize(); addEventListener('resize', resize)

    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    const start = performance.now()
    let frame = 0
    const draw = () => {
      gl.uniform2f(uRes, canvas.width, canvas.height)
      gl.uniform1f(uT, still ? 12 : 12 + (performance.now() - start) / 1000)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      if (!still && !document.hidden) frame = requestAnimationFrame(draw)
    }
    const onVisible = () => { cancelAnimationFrame(frame); draw() }
    document.addEventListener('visibilitychange', onVisible)
    draw()
    return () => { cancelAnimationFrame(frame); removeEventListener('resize', resize); document.removeEventListener('visibilitychange', onVisible) }
  }, [])
  return <canvas ref={ref} className="l-gold" aria-hidden="true" />
}
