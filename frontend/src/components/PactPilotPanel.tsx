import { FormEvent, KeyboardEvent, useState } from 'react'
import type { PactPilotAskRequest } from '../lib/pactPilotService'
import type { PactPilotMessage } from '../types/pactPilot'

type Props = { pactId: string; pactName: string; messages?: PactPilotMessage[]; loading?: boolean; error?: string | null; onAsk?: (request: PactPilotAskRequest) => Promise<PactPilotMessage> }
const suggestions = ['Plan a trip', 'Create a poll', 'Compare hotels', 'Split expenses', 'Rebalance contributions', 'Summarize progress']

function money(amount: number, currency: string) {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount) }
  catch { return `${Math.round(amount)} ${currency}` }
}

function estimateText(estimate: NonNullable<PactPilotMessage['estimate']>) {
  if (estimate.mode === 'alternatives' && estimate.alternatives?.length) {
    return estimate.alternatives.map((alternative) => <div className="pilot-option" key={alternative.option_title}><strong>{alternative.option_title}: ~{money(alternative.total, estimate.currency)}</strong>{alternative.per_person != null ? <small> ~{money(alternative.per_person, estimate.currency)} each</small> : null}</div>)
  }
  return estimate.total != null ? <div className="pilot-option"><strong>Total ~{money(estimate.total, estimate.currency)}{estimate.per_person != null ? ` · ~${money(estimate.per_person, estimate.currency)} per person` : ''}</strong>{estimate.budget != null ? <p>{estimate.within_budget ? 'Within' : 'Over'} the {money(estimate.budget, estimate.currency)} budget by {money(Math.abs(estimate.difference ?? 0), estimate.currency)}.</p> : null}</div> : <small>Total unavailable until prices are confirmed.</small>
}

export function PactPilotPanel({ pactId, pactName, messages = [], loading = false, error: externalError = null, onAsk }: Props) {
  const [draft, setDraft] = useState('')
  const [localMessages, setLocalMessages] = useState<PactPilotMessage[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const conversation = [...messages, ...localMessages]

  async function handleSubmit(event?: FormEvent) {
    event?.preventDefault()
    const prompt = draft.trim()
    if (!prompt || prompt.length > 2000 || sending) return
    setDraft(''); setError(null)
    setLocalMessages((current) => [...current, { id: `pilot-local-${Date.now()}`, role: 'user', body: prompt, created_at: new Date().toISOString() }])
    if (!onAsk) { setError('PactPilot is waiting for its backend connection.'); return }
    setSending(true)
    try {
      const response = await onAsk({ context: { pactId, pactName }, prompt })
      setLocalMessages((current) => [...current, response])
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'PactPilot could not process that request.') }
    finally { setSending(false) }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void handleSubmit() }
  }

  return <section className="workspace-card pilot-panel" aria-labelledby="pact-pilot-heading">
    <div className="pilot-header"><div><p className="section-kicker">PACT / ASSISTANT</p><h2 id="pact-pilot-heading">PactPilot</h2><p>Shape the next move for <strong>{pactName}</strong>.</p></div><span className="pilot-status">READY</span></div>
    <div className="pilot-messages" aria-live="polite">
      {!conversation.length && !loading ? <div className="pilot-empty"><span className="pilot-mark">✦</span><strong>Bring a question to the table.</strong><p>Ask for a plan, estimated costs, suggested tasks, or next steps.</p></div> : null}
      {conversation.map((message) => <article className={`pilot-message ${message.role === 'user' ? 'is-user' : 'is-assistant'}`} key={message.id}><div className="pilot-message-meta"><span>{message.role === 'user' ? 'You' : 'PactPilot'}</span><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div>{message.role === 'assistant' ? <><p>{message.summary}</p>{message.options?.length ? <div className="pilot-plan"><span>Planning options</span>{message.options.map((option) => <div className="pilot-option" key={option.title}><strong>{option.title}</strong><p>{option.description}</p><small>Tradeoff: {option.tradeoff}</small></div>)}</div> : null}{message.tasks?.length ? <div className="pilot-plan"><span>Tasks</span><ul>{message.tasks.map((task, index) => <li key={`${task.title}-${index}`}>{task.title}{task.owner_suggestion ? ` (${task.owner_suggestion})` : ''}{task.due_hint ? ` · ${task.due_hint}` : ''}</li>)}</ul></div> : null}{message.costs?.length ? <div className="pilot-plan"><span>Estimated costs</span><ul>{message.costs.map((cost, index) => <li key={`${cost.item}-${index}`}>{cost.item}{cost.option_title ? ` · ${cost.option_title}` : ''}: ~{money(cost.estimated_amount, cost.currency)}{cost.per_person_amount != null ? ` (~${money(cost.per_person_amount, cost.currency)} each)` : ''}</li>)}</ul>{message.estimate ? <div className="pilot-plan"><span>{message.estimate.mode === 'alternatives' ? 'Estimated totals by alternative' : 'Estimated total'}</span>{estimateText(message.estimate)}<small>{message.estimate.label}</small></div> : null}</div> : null}{message.next_steps?.length ? <div className="pilot-plan"><span>Next steps</span><ul>{message.next_steps.map((step, index) => <li key={`${step}-${index}`}>{step}</li>)}</ul></div> : null}</> : <p>{message.body}</p>}</article>)}
      {loading || sending ? <div className="pilot-loading"><span /> PactPilot is thinking…</div> : null}
    </div>
    {externalError || error ? <p className="form-error" role="alert">{externalError || error}</p> : null}
    <div className="pilot-suggestions" aria-label="Suggested prompts">{suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => setDraft(suggestion)}>{suggestion}</button>)}</div>
    <form className="pilot-composer" onSubmit={handleSubmit}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleKeyDown} placeholder="Ask PactPilot about this Pact…" maxLength={2000} aria-label="Message PactPilot" /><button className="gold-button" type="submit" disabled={!draft.trim() || draft.trim().length > 2000 || sending}>{sending ? 'Sending…' : 'Send'}</button></form>
    <small className="pilot-note">PactPilot can suggest plans, but it cannot approve commitments, move money, or change group decisions.</small>
  </section>
}

