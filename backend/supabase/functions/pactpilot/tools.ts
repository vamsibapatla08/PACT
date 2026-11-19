import type { SupabaseClient } from "npm:@supabase/supabase-js@2"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const pactPilotTools = [
  "read_pact_state", "read_booking_options", "read_booking_state", "prepare_booking_proposal",
  "read_split_state", "prepare_split", "read_rebalance", "prepare_rebalance", "vote_rebalance", "apply_rebalance", "create_poll", "publish_action_card", "enqueue_email",
  "read_tab", "add_expense", "join_expense", "resplit_expense", "import_plan_to_tab",
] as const
export type PactPilotToolName = typeof pactPilotTools[number]

type Args = Record<string, unknown>
type ToolInput = { client: SupabaseClient; pactId: string; tool: string; args: Args }

const isUuid = (value: unknown): value is string => typeof value === "string" && uuid.test(value)

// undefined means "present but malformed", so callers can reject it instead of silently splitting with everyone.
function uuidList(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.length <= 50 && value.every(isUuid) ? value : undefined
}

function centsMap(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const entries = Object.entries(value)
  return entries.length > 0 && entries.every(([id, cents]) => isUuid(id) && Number.isSafeInteger(cents) && (cents as number) >= 0) ? value as Record<string, number> : undefined
}

export function isSupportedTool(value: unknown): value is PactPilotToolName {
  return typeof value === "string" && (pactPilotTools as readonly string[]).includes(value)
}

export async function executePactPilotTool({ client, pactId, tool, args }: ToolInput) {
  if (!isSupportedTool(tool)) throw new Error("Unsupported PactPilot tool")

  if (tool === "read_pact_state") {
    const [pact, milestones, recommendations, decisions, payments] = await Promise.all([
      client.from("pacts").select("pact_id,name,description,budget").eq("pact_id", pactId).maybeSingle(),
      client.from("pact_milestones").select("milestone_id,milestone_key,label,status,position").eq("pact_id", pactId).order("position"),
      client.from("pact_recommendations").select("recommendation_id,summary,created_at").eq("pact_id", pactId).order("created_at", { ascending: false }).limit(10),
      client.from("pact_decisions").select("decision_id,question,status,approval_rule,created_at").eq("pact_id", pactId).order("created_at", { ascending: false }).limit(10),
      client.rpc("get_pact_payment_status", { p_pact_id: pactId }),
    ])
    const failure = [pact, milestones, recommendations, decisions, payments].find((item) => item.error)
    if (failure?.error) throw new Error(failure.error.message)
    return { tool, status: "completed", pact: pact.data, milestones: milestones.data ?? [], recommendations: recommendations.data ?? [], decisions: decisions.data ?? [], payments: payments.data ?? [] }
  }

  if (tool === "read_booking_options") {
    // The booking Edge Function owns the demo inventory. Keep this tool honest:
    // it reports persisted options only; it never invents availability here.
    const { data: bookings, error: bookingError } = await client.from("pact_bookings").select("booking_id").eq("pact_id", pactId)
    if (bookingError) throw new Error(bookingError.message)
    const bookingIds = (bookings ?? []).map((booking) => booking.booking_id)
    if (!bookingIds.length) return { tool, status: "completed", options: [], source: "persisted_demo_proposals" }
    const { data, error } = await client.from("pact_booking_proposals")
      .select("proposal_id,booking_id,provider_ref,option,total_cents,currency,quote_expires_at,proposal_version")
      .in("booking_id", bookingIds)
      .order("created_at", { ascending: false }).limit(20)
    if (error) throw new Error(error.message)
    return { tool, status: "completed", options: data ?? [], source: "persisted_demo_proposals" }
  }

  if (tool === "read_booking_state") {
    const bookingId = args.booking_id
    if (!isUuid(bookingId)) throw new Error("A valid booking_id is required")
    const [booking, proposals, confirmations] = await Promise.all([
      client.from("pact_bookings").select("*").eq("booking_id", bookingId).eq("pact_id", pactId).maybeSingle(),
      client.from("pact_booking_proposals").select("*").eq("booking_id", bookingId).order("proposal_version", { ascending: false }),
      client.from("pact_booking_confirmations").select("confirmation_id,status,provider_type,details,simulated,confirmed_at,created_at").eq("booking_id", bookingId).order("created_at", { ascending: false }),
    ])
    const failure = [booking, proposals, confirmations].find((item) => item.error)
    if (failure?.error) throw new Error(failure.error.message)
    if (!booking.data) throw new Error("Booking is unavailable")
    return { tool, status: "completed", booking: booking.data, proposals: proposals.data ?? [], confirmations: confirmations.data ?? [] }
  }

  if (tool === "prepare_booking_proposal") {
    const bookingId = args.booking_id
    const providerRef = typeof args.provider_ref === "string" ? args.provider_ref.trim() : ""
    const totalCents = typeof args.total_cents === "number" && Number.isInteger(args.total_cents) ? args.total_cents : NaN
    const currency = typeof args.currency === "string" ? args.currency : "USD"
    const expiresAt = typeof args.quote_expires_at === "string" ? args.quote_expires_at : ""
    const fingerprint = typeof args.fingerprint === "string" ? args.fingerprint.trim() : ""
    const option = args.option && typeof args.option === "object" && !Array.isArray(args.option) ? args.option : null
    if (!isUuid(bookingId) || !providerRef || !option || !Number.isSafeInteger(totalCents) || totalCents <= 0 || !expiresAt || !fingerprint) throw new Error("Invalid booking proposal details")
    const { data, error } = await client.rpc("create_pact_booking_proposal", { p_booking_id: bookingId, p_provider_ref: providerRef, p_option: option, p_total_cents: totalCents, p_currency: currency, p_quote_expires_at: expiresAt, p_fingerprint: fingerprint })
    if (error) throw new Error(error.message)
    return { tool, status: "completed", proposal_id: data }
  }

  if (tool === "read_split_state") {
    const bookingId = args.booking_id
    if (!isUuid(bookingId)) throw new Error("A valid booking_id is required")
    const { data, error } = await client.from("pact_booking_splits").select("split_id,booking_id,proposal_id,split_version,split_type,total_cents,currency,status,created_at,pact_booking_split_items(user_id,amount_cents),pact_booking_split_approvals(user_id,decision,created_at)").eq("booking_id", bookingId).order("split_version", { ascending: false })
    if (error) throw new Error(error.message)
    return { tool, status: "completed", splits: data ?? [] }
  }

  if (tool === "prepare_split") {
    const bookingId = args.booking_id
    const proposalId = args.proposal_id
    const splitType = args.split_type === "custom" ? "custom" : "equal"
    const customItems = args.custom_items && Array.isArray(args.custom_items) ? args.custom_items : null
    if (!isUuid(bookingId) || !isUuid(proposalId) || splitType === "custom" && !customItems) throw new Error("Invalid split details")
    const { data, error } = await client.rpc("create_pact_booking_split", { p_booking_id: bookingId, p_proposal_id: proposalId, p_split_type: splitType, p_custom_items: customItems })
    if (error) throw new Error(error.message)
    return { tool, status: "completed", split_id: data }
  }

  if (tool === "read_rebalance") {
    const { data, error } = await client.from("pact_rebalance_proposals").select("proposal_id,pact_id,payment_id,status,before_snapshot,after_snapshot,created_at,updated_at,pact_rebalance_votes(user_id,vote,created_at),pact_rebalance_audit(event_type,details,created_at)").eq("pact_id", pactId).order("created_at", { ascending: false })
    if (error) throw new Error(error.message)
    return { tool, status: "completed", proposals: data ?? [] }
  }

  if (tool === "prepare_rebalance") {
    const paymentId = args.payment_id
    const idempotencyKey = args.idempotency_key
    const snapshot = args.after_snapshot && typeof args.after_snapshot === "object" && !Array.isArray(args.after_snapshot) ? args.after_snapshot : null
    if (!isUuid(paymentId) || !isUuid(idempotencyKey) || !snapshot) throw new Error("Invalid rebalance proposal details")
    const { data, error } = await client.rpc("create_pact_rebalance_proposal", { p_pact_id: pactId, p_payment_id: paymentId, p_after_snapshot: snapshot, p_idempotency_key: idempotencyKey })
    if (error) throw new Error(error.message)
    return { tool, status: "completed", proposal_id: data }
  }

  if (tool === "vote_rebalance") {
    const proposalId = args.proposal_id
    const vote = args.vote === "reject" ? "reject" : args.vote === "approve" ? "approve" : ""
    if (!isUuid(proposalId) || !vote) throw new Error("Invalid rebalance vote")
    const { data, error } = await client.rpc("cast_pact_rebalance_vote", { p_proposal_id: proposalId, p_vote: vote })
    if (error) throw new Error(error.message)
    return { tool, status: "completed", proposal: data }
  }

  if (tool === "apply_rebalance") {
    const proposalId = args.proposal_id
    if (!isUuid(proposalId)) throw new Error("Invalid rebalance proposal")
    const { data, error } = await client.rpc("apply_pact_rebalance_proposal", { p_proposal_id: proposalId })
    if (error) throw new Error(error.message)
    return { tool, ...data }
  }

  if (tool === "create_poll") {
    const question = typeof args.question === "string" ? args.question.trim() : ""
    const options = Array.isArray(args.options) ? args.options.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) : []
    const rule = args.approval_rule === "unanimous" || args.approval_rule === "host" ? args.approval_rule : "majority"
    const recommendationId = args.recommendation_id == null ? null : args.recommendation_id
    if (!question || question.length > 2000 || options.length < 2 || options.length > 20 || (recommendationId !== null && !isUuid(recommendationId))) throw new Error("Invalid poll details")
    void rule
    const cards = options.slice(0, 8).map((name) => ({ name: name.slice(0, 120), price_each: null, link: null, notes: null }))
    const kind = /hotel|stay|airbnb|room/i.test(question) ? "stay" : /flight|fly/i.test(question) ? "flight" : /dinner|restaurant|food|eat/i.test(question) ? "dinner" : /ticket|show|concert|event|game/i.test(question) ? "ticket" : "other"
    const { data, error } = await client.rpc("create_pact_poll", { p_pact_id: pactId, p_title: question.slice(0, 120), p_options: cards, p_kind: kind, p_source: "grok" })
    if (error) throw new Error(error.message)
    return { tool, status: "completed", poll_id: data }
  }

  if (tool === "publish_action_card") {
    const actionType = typeof args.action_type === "string" ? args.action_type : ""
    const state = typeof args.state === "string" ? args.state : "draft"
    const title = typeof args.title === "string" ? args.title.trim() : ""
    const description = typeof args.description === "string" ? args.description : ""
    const payload = args.payload && typeof args.payload === "object" && !Array.isArray(args.payload) ? args.payload : {}
    const idempotencyKey = args.idempotency_key
    const targetId = args.target_id == null ? null : args.target_id
    const operationId = args.operation_id == null ? null : args.operation_id
    if (!isUuid(idempotencyKey) || (targetId !== null && !isUuid(targetId)) || (operationId !== null && !isUuid(operationId)) || !title) throw new Error("Invalid action-card details")
    const { data, error } = await client.rpc("create_pact_action_card", { p_pact_id: pactId, p_action_type: actionType, p_state: state, p_title: title, p_description: description, p_payload: payload, p_target_id: targetId, p_operation_id: operationId, p_idempotency_key: idempotencyKey })
    if (error) throw new Error(error.message)
    return { tool, status: "completed", card_id: data }
  }

  if (tool === "read_tab") {
    const { data, error } = await client.rpc("get_pact_tab", { p_pact_id: pactId })
    if (error) throw new Error(error.message)
    return { tool, status: "completed", tab: data }
  }

  if (tool === "add_expense") {
    const title = typeof args.title === "string" ? args.title.trim() : ""
    const totalCents = args.total_cents
    const paidBy = args.paid_by == null ? null : args.paid_by
    const splitWith = args.split_with == null ? null : uuidList(args.split_with)
    const custom = args.custom_shares == null ? null : centsMap(args.custom_shares)
    if (!title || title.length > 120 || !Number.isSafeInteger(totalCents) || (totalCents as number) <= 0 || (paidBy !== null && !isUuid(paidBy)) || splitWith === undefined || custom === undefined) throw new Error("Invalid expense details")
    const { data, error } = await client.rpc("add_pact_expense", { p_pact_id: pactId, p_title: title, p_total_cents: totalCents, p_paid_by: paidBy, p_split_with: splitWith, p_custom_shares: custom, p_source: "grok" })
    if (error) throw new Error(error.message)
    return { tool, status: "completed", expense_id: data }
  }

  if (tool === "join_expense") {
    // "booking": true joins the pact's funded booking, putting it on the tab first if it isn't there yet.
    let expenseId = args.expense_id
    if (args.booking === true && !isUuid(expenseId)) {
      const imported = await client.rpc("import_pact_plan_to_tab", { p_pact_id: pactId })
      if (imported.error) throw new Error(imported.error.message)
      expenseId = imported.data
    }
    if (!isUuid(expenseId)) throw new Error("A valid expense_id is required")
    const { data, error } = await client.rpc("join_pact_expense", { p_expense_id: expenseId })
    if (error) throw new Error(error.message)
    return { tool, ...data }
  }

  if (tool === "resplit_expense") {
    const splitWith = args.split_with == null ? null : uuidList(args.split_with)
    const custom = args.custom_shares == null ? null : centsMap(args.custom_shares)
    if (!isUuid(args.expense_id) || splitWith === undefined || custom === undefined || (!splitWith && !custom)) throw new Error("Invalid re-split details")
    const { data, error } = await client.rpc("resplit_pact_expense", { p_expense_id: args.expense_id, p_split_with: splitWith, p_custom_shares: custom })
    if (error) throw new Error(error.message)
    return { tool, ...data }
  }

  if (tool === "import_plan_to_tab") {
    const { data, error } = await client.rpc("import_pact_plan_to_tab", { p_pact_id: pactId })
    if (error) throw new Error(error.message)
    return { tool, status: "completed", expense_id: data }
  }

  const entityId = args.entity_id
  const emailType = args.email_type
  const payload = args.payload && typeof args.payload === "object" && !Array.isArray(args.payload) ? args.payload : {}
  if (!isUuid(entityId) || (emailType !== "demo_itinerary" && emailType !== "verified_payment_receipt")) throw new Error("Invalid email request")
  const { data, error } = await client.rpc("enqueue_pact_email", { p_pact_id: pactId, p_email_type: emailType, p_entity_id: entityId, p_payload: payload })
  if (error) throw new Error(error.message)
  return { tool, status: "queued", email_id: data }
}
