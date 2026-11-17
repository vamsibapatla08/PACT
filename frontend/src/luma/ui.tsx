import { useEffect, type ReactNode } from 'react'
import type { ItemKind, PactKind } from './store'

const paths: Record<string, ReactNode> = {
  home: <path d="M4 11l8-6.5 8 6.5v8.5a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />,
  pacts: <><rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  friends: <><circle cx="9" cy="8.5" r="3.3" /><path d="M2.8 19.5a6.2 6.2 0 0 1 12.4 0" /><circle cx="17" cy="9.5" r="2.5" /><path d="M16.6 14a4.8 4.8 0 0 1 4.9 5" /></>,
  wallet: <><rect x="3" y="6" width="18" height="13.5" rx="3" /><path d="M3 10h18M16.5 14.5h1.5" /><path d="M6 6l9.5-2.5a1.5 1.5 0 0 1 1.9 1.4V6" /></>,
  trip: <path d="M21 15.5v-1.8l-7.5-4.7V4.2a1.5 1.5 0 0 0-3 0V9L3 13.7v1.8l7.5-2.3v4.9l-2 1.5V21l3.5-1 3.5 1v-1.4l-2-1.5v-4.9z" />,
  flight: <path d="M21 15.5v-1.8l-7.5-4.7V4.2a1.5 1.5 0 0 0-3 0V9L3 13.7v1.8l7.5-2.3v4.9l-2 1.5V21l3.5-1 3.5 1v-1.4l-2-1.5v-4.9z" />,
  event: <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4zM14 6v12" />,
  ticket: <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4zM14 6v12" />,
  stay: <><path d="M3 18.5V7M3 14h18v4.5M21 14v-2.5a3 3 0 0 0-3-3h-7V14" /><circle cx="7" cy="11" r="2" /></>,
  dinner: <><path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10" /><path d="M17 21V3c-2 1.5-3 4-3 7v3h3" /></>,
  other: <path d="M12 3l1.8 4.6L18.5 9l-4.7 1.6L12 15l-1.8-4.4L5.5 9l4.7-1.4zM18.5 15l.8 2 2 .8-2 .7-.8 2-.8-2-2-.7 2-.8z" />,
  box: <><path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z" /><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9" /></>,
  pin: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  checkCircle: <><circle cx="12" cy="12" r="9.5" /><path d="M7.5 12.3l3 3 6-6.3" /></>,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  back: <path d="M15 5l-7 7 7 7" />,
  link: <path d="M7 17L17 7M9 7h8v8" />,
  list: <path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h12M4 6.5h.01M4 12h.01M4 17.5h.01" />,
  text: <path d="M4 6h16M4 10.5h16M4 15h11M4 19.5h7" />,
  sparkles: <path d="M12 3l1.8 4.6L18.5 9l-4.7 1.6L12 15l-1.8-4.4L5.5 9l4.7-1.4zM18.5 15l.8 2 2 .8-2 .7-.8 2-.8-2-2-.7 2-.8z" />,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>,
  wave: <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10.5v3" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  shield: <><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z" /><path d="M8.6 12.2l2.3 2.3 4.6-4.8" /></>,
  seal: <><path d="M12 2.8l2.1 1.6 2.6-.3 1 2.4 2.4 1-.3 2.6 1.6 2.1-1.6 2.1.3 2.6-2.4 1-1 2.4-2.6-.3L12 21.2l-2.1-1.6-2.6.3-1-2.4-2.4-1 .3-2.6L2.6 12l1.6-2.1-.3-2.6 2.4-1 1-2.4 2.6.3z" /><path d="M8.5 12.2l2.4 2.4 4.6-4.9" /></>,
  chain: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  crown: <path d="M4 17.5L3 8l5 4 4-6.5 4 6.5 5-4-1 9.5z" />,
}

export function Icon({ name, size }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={size ? { width: size, height: size } : undefined} aria-hidden="true">
      {paths[name] ?? paths.other}
    </svg>
  )
}

export const kindIcon = (k: PactKind | ItemKind) => k

export function Avatar({ name, url, size = 28 }: { name?: string | null; url?: string | null; size?: number }) {
  const style = { width: size, height: size, fontSize: size * 0.42 }
  return url
    ? <img className="l-av" style={style} src={url} alt="" referrerPolicy="no-referrer" />
    : <span className="l-av" style={style}>{(name || '?').charAt(0).toUpperCase()}</span>
}

export function Stack({ people, max = 4, size = 22 }: { people: { name: string | null; avatar_url: string | null }[]; max?: number; size?: number }) {
  return (
    <span className="l-stack">
      {people.slice(0, max).map((p, i) => <Avatar key={i} name={p.name} url={p.avatar_url} size={size} />)}
      {people.length > max && <span className="l-more">+{people.length - max}</span>}
    </span>
  )
}

export function Cover({ kind, name, big, sub }: { kind: PactKind; name: string; big?: boolean; sub?: string | null }) {
  return (
    <div className={big ? 'l-cover big' : 'l-cover'}>
      <Icon name={kind} />
      <b>{name}</b>
      {big && sub && <small>{sub}</small>}
    </div>
  )
}

export function Grok({ size = 18 }: { size?: number }) {
  return <img src="/grok.svg" alt="" style={{ width: size, height: size }} />
}

export function Modal({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="l-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="l-modal" role="dialog" aria-modal="true">
        <div className="l-modal-head"><h2>{title}</h2><button className="l-icon-btn" type="button" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        {children}
      </div>
    </div>
  )
}

export function Busy({ text }: { text: string }) {
  return <span className="l-busy"><span className="l-spin" />{text}</span>
}

export function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return <button type="button" className={on ? 'l-switch on' : 'l-switch'} onClick={() => onChange(!on)} aria-pressed={on}><span>{label}</span><i /></button>
}

/** Pact Verified: QuickNode confirmed every payment on Arc. Confirmed on Arc: the chain shows it, QuickNode hasn't yet. */
export function VerifiedBadge({ level, compact }: { level: 'verified' | 'onchain'; compact?: boolean }) {
  const verified = level === 'verified'
  return (
    <span className={`l-verify ${verified ? 'ok' : 'wait'}${compact ? ' compact' : ''}`} title={verified ? 'Every payment was checked on Arc by QuickNode' : 'On the Arc chain. Waiting for QuickNode to confirm it.'}>
      <Icon name={verified ? 'shield' : 'chain'} />
      {verified ? 'Pact Verified' : compact ? 'On Arc' : 'Confirmed on Arc'}
    </span>
  )
}
