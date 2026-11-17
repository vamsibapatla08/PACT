export type PactPilotActionState = 'draft' | 'awaiting approval' | 'approved' | 'rejected' | 'pending verification' | 'completed' | 'failed'
type Props = { eyebrow: string; title: string; description: string; status?: string; state?: PactPilotActionState; actionLabel?: string; disabled?: boolean; onAction?: () => void }

export function PactPilotActionCard({ eyebrow, title, description, status, state, actionLabel, disabled = false, onAction }: Props) {
  const displayStatus = state ? state.toUpperCase() : status
  return <article className={`pilot-action-card${state ? ` is-${state.replaceAll(' ', '-')}` : ''}`}><span>{eyebrow}</span><strong>{title}</strong><p>{description}</p><div>{displayStatus ? <small>{displayStatus}</small> : null}{actionLabel ? <button className="outline-button" type="button" disabled={disabled} onClick={onAction}>{actionLabel}</button> : null}</div></article>
}
