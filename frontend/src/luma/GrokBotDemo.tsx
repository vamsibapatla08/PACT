import { useEffect, useRef, useState } from 'react'
import { Icon } from './ui'

/** The Grok Bot demo on the landing page: a silent video made from real screenshots of a Pact Pilot session, with
 *  personal details removed. It plays while on screen and loops; the steps and caption follow along, and a step jumps there. */

const VIDEO = '/grokbot/pact-pilot-demo.mp4'
const POSTER = '/grokbot/pact-pilot-demo-poster.webp'
// Seconds into the video where each step and caption starts.
const STAGES = [
  { label: 'Create the bot', at: 0 },
  { label: 'Paste the prompt', at: 4 },
  { label: 'Connect', at: 8.6 },
  { label: 'Pick a pact', at: 15.2 },
  { label: 'Plan and automate', at: 19 },
  { label: 'Vote in Pact', at: 37 },
]
const CAPTIONS = [
  { at: 0, text: 'Create a bot called Pact Pilot' },
  { at: 4, text: 'Paste the setup prompt from this page' },
  { at: 8.6, text: 'It adds the Pact connector and saves how to plan with you' },
  { at: 13, text: 'Connected. It reads your real pacts' },
  { at: 15.2, text: 'Pick one to plan' },
  { at: 19, text: "It finds who still owes and what's left" },
  { at: 22.8, text: 'Ask it to keep looking and send you updates' },
  { at: 29, text: 'It checks every morning and sends what it finds' },
  { at: 33.6, text: 'Say yes, and it puts 4 to a group vote' },
  { at: 37, text: 'The vote lands in your Pact' },
  { at: 40.3, text: 'Tap to approve' },
  { at: 41.2, text: "Done. It's on the plan" },
]
const last = <T extends { at: number }>(list: T[], t: number) => list.reduce((k, x, i) => (t >= x.at ? i : k), 0)

export function GrokBotDemo() {
  const video = useRef<HTMLVideoElement>(null)
  const [t, setT] = useState(0)
  const still = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

  // Play only while it's on screen.
  useEffect(() => {
    const v = video.current
    if (!v || still) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) void v.play().catch(() => undefined); else v.pause() }, { threshold: 0.35 })
    io.observe(v)
    return () => io.disconnect()
  }, [still])

  const stage = last(STAGES, t)
  const jump = (at: number) => { const v = video.current; if (!v) return; v.currentTime = at; setT(at); void v.play().catch(() => undefined) }

  return (
    <div className="x-gbd">
      <ol className="x-gbd-stages" aria-label="Demo steps">
        {STAGES.map((s, k) => (
          <li key={s.label} className={k < stage ? 'done' : k === stage ? 'now' : ''}>
            <button type="button" onClick={() => jump(s.at)}><span>{k < stage ? <Icon name="check" size={12} /> : k + 1}</span>{s.label}</button>
          </li>
        ))}
      </ol>
      <div className="x-gbd-screen">
        <video ref={video} src={VIDEO} poster={POSTER} muted loop playsInline preload="metadata" controls={still}
          aria-label="Demo: making a Pact Pilot bot in Grok Bot, connecting it, having it find things to do in Austin, putting 4 to a vote, and approving one in the Pact app"
          onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} />
      </div>
      <p className="x-gbd-caption" key={last(CAPTIONS, t)}>{CAPTIONS[last(CAPTIONS, t)].text}</p>
    </div>
  )
}
