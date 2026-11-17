type Props = { eyebrow: string; title: string; description: string; status?: string; actionLabel?: string; disabled?: boolean; onAction?: () => void }

export function PactPilotActionCard({ eyebrow, title, description, status, actionLabel, disabled = false, onAction }: Props) {
  return <article className="pilot-action-card"><span>{eyebrow}</span><strong>{title}</strong><p>{description}</p><div>{status ? <small>{status}</small> : null}{actionLabel ? <button className="outline-button" type="button" disabled={disabled} onClick={onAction}>{actionLabel}</button> : null}</div></article>
}
