type Props = { title: string; message: string; actionLabel?: string; onAction?: () => void }
export function StatusPanel({ title, message, actionLabel, onAction }: Props) {
  return <section className="status-panel" role="status"><div className="status-emblem" aria-hidden="true"><span>P</span><i /></div><p className="section-kicker">PACT / STATUS</p><h2>{title}</h2><p>{message}</p>{actionLabel && onAction ? <button className="text-action" type="button" onClick={onAction}>{actionLabel}<span>→</span></button> : null}</section>
}
