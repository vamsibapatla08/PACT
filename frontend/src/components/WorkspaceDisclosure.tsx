import { useId, useState, type ReactNode } from 'react'

type Props = {
  label: string
  title: string
  summary?: string
  defaultOpen?: boolean
  children: ReactNode
}

export function WorkspaceDisclosure({ label, title, summary, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()
  return <section className={`workspace-disclosure${open ? ' is-open' : ''}`}>
    <button className="workspace-disclosure-trigger" type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
      <span><small className="section-kicker">{label}</small><strong>{title}</strong>{summary ? <em>{summary}</em> : null}</span>
      <i aria-hidden="true">{open ? '−' : '+'}</i>
    </button>
    <div className="workspace-disclosure-content" id={panelId} hidden={!open}>{children}</div>
  </section>
}
