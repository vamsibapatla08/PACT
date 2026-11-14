import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { PactChatMessage } from '../types/chat'
import type { PactMember } from '../types/pact'

type Props = {
  pactId: string
  pactName: string
  currentUserId: string
  currentUserName: string
  currentUserAvatar?: string | null
  members?: PactMember[]
  messages?: PactChatMessage[]
  loading?: boolean
  error?: string | null
  backendReady?: boolean
  onSend?: (pactId: string, body: string) => Promise<void>
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

export function ChatPanel({ pactId, pactName, currentUserId, currentUserName, currentUserAvatar, members = [], messages = [], loading = false, error = null, backendReady = false, onSend }: Props) {
  const [draft, setDraft] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const canSend = draft.trim().length > 0 && draft.length <= 2000 && !sending

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 120
    if (nearBottom) element.scrollTop = element.scrollHeight
  }, [messages.length])

  async function send() {
    const body = draft.trim()
    if (!body || body.length > 2000 || sending) return
    if (!backendReady || !onSend) { setSendError('Chat messaging is waiting for the backend connection.'); return }
    setSending(true); setSendError(null)
    try { await onSend(pactId, body); setDraft('') }
    catch (reason) { setSendError(reason instanceof Error ? reason.message : 'Your message could not be sent.') }
    finally { setSending(false) }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() }
  }

  return <section className="chat-panel workspace-card" aria-labelledby="pactchat-title">
    <div className="chat-header"><div><p className="section-kicker">PACT / CONVERSATION</p><h2 id="pactchat-title">PactChat</h2><p>{pactName} · private group conversation</p></div><span className={`chat-status${backendReady ? ' is-ready' : ''}`}><i />{backendReady ? 'LIVE' : 'PREPARING'}</span></div>
    <div className="chat-messages" ref={scrollRef} aria-live="polite">
      {loading ? <div className="chat-state"><span className="chat-loader" /> Loading conversation…</div> : null}
      {!loading && error ? <div className="chat-state chat-state-error" role="alert">{error}</div> : null}
      {!loading && !error && messages.length === 0 ? <div className="chat-state"><span className="chat-empty-mark">•</span><strong>No messages yet</strong><span>Your Pact conversation will appear here.</span></div> : null}
      {!loading && !error && messages.length > 0 ? messages.map((message) => {
        const mine = message.sender_id === currentUserId
        const rosterMember = members.find((member) => member.user_id === message.sender_id)
        const name = message.sender_name || rosterMember?.profile?.full_name || (mine ? currentUserName : 'Pact member')
        const avatar = message.sender_avatar_url || rosterMember?.profile?.avatar_url || (mine ? currentUserAvatar : null)
        return <article className={`chat-message${mine ? ' is-mine' : ''}`} key={message.id}><div className="chat-avatar">{avatar ? <img src={avatar} alt="" referrerPolicy="no-referrer" /> : <span>{name.charAt(0).toUpperCase()}</span>}</div><div className="chat-message-body"><div className="chat-message-meta"><strong>{name}{mine ? ' · you' : ''}</strong><time dateTime={message.created_at}>{formatTime(message.created_at)}</time></div><p>{message.body}</p></div></article>
      }) : null}
    </div>
    <div className="chat-composer"><textarea value={draft} maxLength={2000} onChange={(event) => { setDraft(event.target.value); setSendError(null) }} onKeyDown={handleKeyDown} placeholder={backendReady ? 'Write to your Pact…' : 'Compose a message…'} aria-label="Message" disabled={sending} /> <div className="chat-composer-footer"><span className={draft.length > 2000 ? 'is-over' : ''}>{draft.length}/2000 · Enter to send · Shift+Enter for a new line</span><button className="outline-button" type="button" onClick={() => void send()} disabled={!canSend}>{sending ? 'Sending…' : 'Send'}<span>↑</span></button></div></div>
    {sendError ? <p className="form-error chat-error" role="alert">{sendError}</p> : null}
  </section>
}
