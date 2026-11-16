import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { User } from '@supabase/supabase-js'
import { AppShell, avatarUrl, displayName } from '../components/AppShell'
import { StatusPanel } from '../components/StatusPanel'
import { createPactInvitation, friendlyError, getPactWorkspace } from '../lib/pactService'
import type { PactWorkspace, Profile } from '../types/pact'
import { ChatPanel } from '../components/ChatPanel'
import { PactPilotPanel } from '../components/PactPilotPanel'
import { askPactPilot } from '../lib/pactPilotService'
import { listPactMessages, sendPactMessage, subscribeToPactMessages } from '../lib/chatService'
import type { PactChatMessage } from '../types/chat'
import { PactMoneyPanel } from '../components/PactMoneyPanel'
import { createPactFundingPlan, createPactMoneyWallet, getPactMemberWallets, getPactMoneyWalletStatus, getPactPaymentStatus, isPaymentBackendUnavailable, pactMoneyWalletEnabled, resetPactMoneyPin, runPactAction, sendPactMoney, type PactAction } from '../lib/pactMoneyService'
import type { PactMoneyStatus, PactMoneyTransfer, PactMoneyWallet, PactPaymentStatusRow } from '../types/pactMoney'
import { PactFlowPanel } from '../components/PactFlowPanel'
import { PactDecidePanel } from '../components/PactDecidePanel'
import { loadPactFlow, castPactDecisionVote, createPactDecision, savePactRecommendation, seedPactMilestones } from '../lib/pactFlowService'
import type { PactDecision, PactMilestone, PactRecommendation } from '../types/pactFlow'

type Props = { user: User; profile: Profile | null; pactId: string; onNavigate: (path: string) => void; onSignOut: () => Promise<void>; signingOut: boolean }

export function PactWorkspacePage({ user, profile, pactId, onNavigate, onSignOut, signingOut }: Props) {
  const reduceMotion = useReducedMotion()
  const [pact, setPact] = useState<PactWorkspace | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [activeTool, setActiveTool] = useState<'chat' | 'pilot'>('chat')
  const [chatMessages, setChatMessages] = useState<PactChatMessage[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [chatLive, setChatLive] = useState(false)
  const [moneyStatus, setMoneyStatus] = useState<PactMoneyStatus>('unavailable')
  const [moneyWallet, setMoneyWallet] = useState<PactMoneyWallet | null>(null)
  const [moneyError, setMoneyError] = useState<string | null>(null)
  const [paymentRows, setPaymentRows] = useState<PactPaymentStatusRow[] | null>(null)
  const [memberWallets, setMemberWallets] = useState<{ user_id: string; address: string }[] | null>(null)
  const [flow, setFlow] = useState<{ milestones: PactMilestone[]; recommendations: PactRecommendation[]; decisions: PactDecision[] }>({ milestones: [], recommendations: [], decisions: [] })
  const [flowLoading, setFlowLoading] = useState(false)
  const [flowError, setFlowError] = useState<string | null>(null)

  useEffect(() => {
    if (!pact) return
    let active = true
    setPaymentRows(null)
    getPactPaymentStatus(pact.id).then((rows) => { if (active) setPaymentRows(rows) }).catch((reason) => {
      if (active && !isPaymentBackendUnavailable(reason)) setMoneyError(reason instanceof Error ? reason.message : 'Payment status could not be loaded.')
    })
    return () => { active = false }
  }, [pact?.id])

  useEffect(() => {
    if (!pact) return
    let active = true
    setMemberWallets(null)
    getPactMemberWallets(pact.id).then((wallets) => { if (active) setMemberWallets(wallets) }).catch(() => { if (active) setMemberWallets(null) })
    return () => { active = false }
  }, [pact?.id])

  useEffect(() => {
    let active = true
    getPactWorkspace(pactId).then((value) => { if (active) setPact(value) }).catch((reason) => { if (active) setError(friendlyError(reason, 'This Pact could not be opened.')) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [pactId])

  useEffect(() => {
    if (!pact) return
    let active = true
    setChatLoading(true); setChatError(null); setChatLive(false); setChatMessages([])
    const unsubscribe = subscribeToPactMessages(pact.id, (message) => {
      if (!active) return
      setChatMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)))
    }, (status) => {
      if (!active) return
      setChatLive(status === 'SUBSCRIBED')
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setChatError('Live updates are unavailable. Your conversation can still be refreshed.')
    })
    listPactMessages(pact.id).then((history) => {
      if (!active) return
      setChatMessages((current) => [...history, ...current].filter((message, index, all) => all.findIndex((item) => item.id === message.id) === index).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)))
    }).catch((reason) => { if (active) setChatError(friendlyError(reason, 'The Pact conversation could not be loaded.')) }).finally(() => { if (active) setChatLoading(false) })
    return () => { active = false; unsubscribe(); setChatLive(false) }
  }, [pact?.id])

  useEffect(() => {
    let active = true
    setMoneyStatus('loading'); setMoneyWallet(null); setMoneyError(null)
    getPactMoneyWalletStatus().then((wallet) => {
      if (!active) return
      setMoneyWallet(wallet); setMoneyStatus(wallet ? 'ready' : 'unavailable')
    }).catch((reason) => {
      if (!active) return
      setMoneyStatus('error'); setMoneyError(reason instanceof Error ? reason.message : 'Wallet status could not be checked.')
    })
    return () => { active = false }
  }, [user.id])

  useEffect(() => {
    if (!pact) return
    let active = true
    setFlowLoading(true); setFlowError(null)
    seedPactMilestones(pact.id).then(() => loadPactFlow(pact.id)).then((value) => { if (active) setFlow(value) }).catch((reason) => { if (active) setFlowError(reason instanceof Error ? reason.message : 'Pact flow could not be loaded.') }).finally(() => { if (active) setFlowLoading(false) })
    return () => { active = false }
  }, [pact?.id])

  async function handleInvite() {
    if (inviteCode) {
      try {
        await navigator.clipboard.writeText(inviteCode)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1800)
      } catch { setInviteError('Copy was blocked. Select the invitation code and copy it manually.') }
      return
    }
    setInviteLoading(true); setInviteError(null)
    try { setInviteCode(await createPactInvitation(pactId)); setCopied(false) }
    catch (reason) { setInviteError(friendlyError(reason, 'The invitation could not be created for this Pact.')) }
    finally { setInviteLoading(false) }
  }

  async function handleCreateWallet() {
    setMoneyStatus('loading')
    setMoneyError(null)
    try {
      const wallet = await createPactMoneyWallet()
      setMoneyWallet(wallet)
      setMoneyStatus('ready')
    } catch (reason) {
      setMoneyStatus('error')
      setMoneyError(reason instanceof Error ? reason.message : 'Wallet creation could not be completed.')
    }
  }

  async function handleSendMoney(toUserId: string, amount: string, requestId: string, onUpdate: (transfer: PactMoneyTransfer) => void) {
    const transfer = await sendPactMoney(pactId, toUserId, amount, requestId, onUpdate)
    if (transfer.status === 'confirmed') getPactMoneyWalletStatus().then((wallet) => { if (wallet) setMoneyWallet(wallet) }).catch(() => {})
    return transfer
  }

  // The date picker gives local time with no zone, so it becomes a UTC instant here, before the server reads it.
  async function handleCreateFundingPlan(input: { shareUsdc: string; deadline: string; payeeAddress: string }) {
    await createPactFundingPlan({ pactId, ...input, deadline: new Date(input.deadline).toISOString() })
    setPaymentRows(await getPactPaymentStatus(pactId))
  }

  async function handlePactAction(action: PactAction) {
    const txHash = await runPactAction(action, pactId)
    setPaymentRows(await getPactPaymentStatus(pactId))
    getPactMoneyWalletStatus().then((wallet) => { if (wallet) setMoneyWallet(wallet) }).catch(() => {})
    return txHash
  }

  async function handleVote(decisionId: string, vote: 'approve' | 'reject') {
    try { await castPactDecisionVote(decisionId, vote); setFlow(await loadPactFlow(pactId)) }
    catch (reason) { setFlowError(reason instanceof Error ? reason.message : 'Your vote could not be recorded.') }
  }

  async function handleCreateDecision(question: string, options: string[], rule: PactDecision['approval_rule']) {
    try { await createPactDecision(pactId, question, options, rule); setFlow(await loadPactFlow(pactId)) }
    catch (reason) { setFlowError(reason instanceof Error ? reason.message : 'The decision could not be created.') }
  }

  async function handleSubmitRecommendation(recommendation: PactRecommendation) {
    const optionTitles = recommendation.options.map((option) => typeof option === 'string' ? option : option && typeof option === 'object' && 'title' in option && typeof option.title === 'string' ? option.title : '').filter(Boolean)
    if (optionTitles.length < 2) { setFlowError('This recommendation does not contain two valid options to vote on.'); return }
    try { await createPactDecision(pactId, `Approve recommendation: ${recommendation.summary}`, optionTitles, 'majority', recommendation.recommendation_id); setFlow(await loadPactFlow(pactId)) }
    catch (reason) { setFlowError(reason instanceof Error ? reason.message : 'The recommendation could not be submitted for approval.') }
  }

  async function askAndPersist(request: Parameters<typeof askPactPilot>[0]) {
    const response = await askPactPilot(request)
    await savePactRecommendation(request.context.pactId, { summary: response.summary || response.body, options: response.options, tasks: response.tasks, costs: response.costs, next_steps: response.next_steps })
    setFlow(await loadPactFlow(request.context.pactId))
    return response
  }

  return <AppShell user={user} profile={profile} current="pacts" onNavigate={onNavigate} onSignOut={onSignOut} signingOut={signingOut}>
    <motion.section className="workspace-page" initial={reduceMotion ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .65 }}>
      <button className="back-link" type="button" onClick={() => onNavigate('/dashboard')}>← My Pacts</button>
      {loading ? <div className="loading-line"><span /> Opening your Pact…</div> : null}
      {error ? <StatusPanel title="Pact unavailable." message={error} actionLabel="Return to dashboard" onAction={() => onNavigate('/dashboard')} /> : null}
      {pact ? <>
        <div className="workspace-heading"><div><p className="section-kicker">PACT / WORKSPACE</p><h1>{pact.name}</h1><p>Shared planning starts here.</p></div><span className="status-chip"><i /> Active</span></div>
        <div className="workspace-grid">
          <section className="workspace-card"><p className="section-kicker">MEMBERS / {pact.members.length.toString().padStart(2, '0')}</p><h2>People in this Pact</h2><div className="member-list">{pact.members.map((member) => { const isCurrentUser = member.user_id === user.id; const memberName = member.profile?.full_name || (isCurrentUser ? displayName(user, profile) : 'Pact member'); const memberAvatar = member.profile?.avatar_url || (isCurrentUser ? avatarUrl(user, profile) : null); return <div className="member-row" key={member.user_id}>{memberAvatar ? <img src={memberAvatar} alt="" referrerPolicy="no-referrer" /> : <span>{memberName.charAt(0)}</span>}<strong>{memberName}{isCurrentUser ? ' (you)' : ''}</strong><small>{member.role}</small></div> })}</div></section>
          <section className="workspace-card invite-card"><p className="section-kicker">INVITATION / SHARE</p><h2>Bring your people in.</h2><p>Generate a secure invitation for someone you trust.</p><code>{inviteCode || 'NO INVITATION GENERATED'}</code>{inviteError ? <p className="form-error" role="alert">{inviteError}</p> : null}<button className="outline-button" type="button" onClick={handleInvite} disabled={inviteLoading}>{inviteLoading ? 'Creating invite…' : copied ? 'Copied' : inviteCode ? 'Copy invite code' : 'Generate invitation'}</button></section>
        </div>
        <div className="workspace-assist-tabs" role="tablist" aria-label="Pact workspace tools">
          <button className={`workspace-assist-tab ${activeTool === 'chat' ? 'is-active' : ''}`} type="button" role="tab" aria-selected={activeTool === 'chat'} aria-controls="pact-chat-panel" onClick={() => setActiveTool('chat')}>Chat</button>
          <button className={`workspace-assist-tab ${activeTool === 'pilot' ? 'is-active' : ''}`} type="button" role="tab" aria-selected={activeTool === 'pilot'} aria-controls="pact-pilot-panel" onClick={() => setActiveTool('pilot')}>PactPilot</button>
        </div>
        <div className="workspace-assist-grid">
          <div className={`workspace-assist-panel workspace-assist-chat ${activeTool === 'chat' ? 'is-mobile-active' : ''}`} id="pact-chat-panel">
            <ChatPanel pactId={pact.id} pactName={pact.name} currentUserId={user.id} currentUserName={displayName(user, profile)} currentUserAvatar={avatarUrl(user, profile)} members={pact.members} messages={chatMessages} loading={chatLoading} error={chatError} backendReady={chatLive} onSend={sendPactMessage} />
          </div>
          <div className={`workspace-assist-panel workspace-assist-pilot ${activeTool === 'pilot' ? 'is-mobile-active' : ''}`} id="pact-pilot-panel">
            <PactPilotPanel pactId={pact.id} pactName={pact.name} onAsk={askAndPersist} />
          </div>
        </div>
        <PactMoneyPanel pactName={pact.name} memberCount={pact.members.length} isHost={pact.members.some((member) => member.user_id === user.id && member.role === 'host')} status={moneyStatus} wallet={moneyWallet} error={moneyError} walletEnabled={pactMoneyWalletEnabled} onCreateWallet={handleCreateWallet} onResetPin={pactMoneyWalletEnabled ? resetPactMoneyPin : undefined} recipients={pact.members.filter((m) => m.user_id !== user.id).map((m) => ({ userId: m.user_id, name: m.profile?.full_name || 'Pact member', hasWallet: memberWallets ? memberWallets.some((w) => w.user_id === m.user_id) : undefined, address: memberWallets?.find((w) => w.user_id === m.user_id)?.address }))} onSend={pactMoneyWalletEnabled ? handleSendMoney : undefined} paymentRows={paymentRows} onCreateFundingPlan={handleCreateFundingPlan} currentUserId={user.id} onPactAction={pactMoneyWalletEnabled ? handlePactAction : undefined} />
        <div className="workspace-decision-grid"><PactFlowPanel milestones={flow.milestones} recommendations={flow.recommendations} decisions={flow.decisions} loading={flowLoading} error={flowError} onSubmitRecommendation={handleSubmitRecommendation} /><PactDecidePanel decisions={flow.decisions} onVote={handleVote} onCreate={handleCreateDecision} error={flowError} /></div>
        <section className="workspace-coming"><span>PACT / NEXT LAYER</span><strong>Conversation, decisions, and payments will live here.</strong><p>Chat, plans, votes, and payment features are not in the current backend migration yet.</p></section>
      </> : null}
    </motion.section>
  </AppShell>
}
