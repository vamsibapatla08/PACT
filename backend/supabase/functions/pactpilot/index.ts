import { createClient } from "npm:@supabase/supabase-js@2"
import { executePactPilotTool, isSupportedTool } from "./tools.ts"

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const planSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "options", "tasks", "costs", "estimate", "next_steps", "actions"],
  properties: {
    summary: { type: "string" },
    options: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description", "tradeoff"],
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          tradeoff: { type: "string" },
        },
      },
    },
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "owner_suggestion", "due_hint"],
        properties: {
          title: { type: "string" },
          owner_suggestion: { type: "string" },
          due_hint: { type: "string" },
        },
      },
    },
    costs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "estimated_amount", "currency", "per_person_amount", "option_title", "is_shared"],
        properties: {
          item: { type: "string" },
          estimated_amount: { type: "number" },
          currency: { type: "string" },
          per_person_amount: { type: "number" },
          option_title: { type: ["string", "null"] },
          is_shared: { type: "boolean" },
        },
      },
    },
    estimate: {
      type: "object",
      additionalProperties: false,
      required: ["currency", "group_size", "budget"],
      properties: {
        currency: { type: "string" },
        group_size: { type: "integer" },
        budget: { type: "number" },
      },
    },
    next_steps: { type: "array", items: { type: "string" } },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tool", "args", "requires_confirmation"],
        properties: {
          tool: { type: "string", enum: ["read_pact_state", "read_booking_options", "read_booking_state", "prepare_booking_proposal", "read_split_state", "prepare_split", "read_rebalance", "prepare_rebalance", "vote_rebalance", "apply_rebalance", "create_poll", "publish_action_card", "enqueue_email"] },
          args: { type: "object", additionalProperties: true },
          requires_confirmation: { type: "boolean" },
        },
      },
    },
  },
}

const estimateLabel =
  "Estimates only. Check real prices before anyone commits or pays."

type Fields = Record<string, unknown>

const isRecord = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null

const isAmount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0

const round = (value: number) => Math.round(value * 100) / 100

function cleanExtras(plan: Fields, pactBudget: unknown) {
  const tasks = (Array.isArray(plan.tasks) ? plan.tasks : [])
    .filter((task): task is Fields =>
      isRecord(task) && typeof task.title === "string" && task.title.trim() !== ""
    )
    .map((task) => ({
      title: task.title as string,
      owner_suggestion: typeof task.owner_suggestion === "string" &&
          task.owner_suggestion.trim()
        ? task.owner_suggestion.trim()
        : null,
      due_hint: typeof task.due_hint === "string" ? task.due_hint : "",
    }))

  const extras = isRecord(plan.estimate) ? plan.estimate : {}
  const currency = typeof extras.currency === "string" && extras.currency.trim()
    ? extras.currency.trim().toUpperCase()
    : "USD"
  const groupSize = Number.isInteger(extras.group_size) &&
      (extras.group_size as number) > 0
    ? extras.group_size as number
    : null

  const costs = (Array.isArray(plan.costs) ? plan.costs : [])
    .filter((cost): cost is Fields =>
      isRecord(cost) && typeof cost.item === "string" &&
      isAmount(cost.estimated_amount)
    )
    .map((cost) => {
      const amount = round(cost.estimated_amount as number)
      return {
        item: cost.item as string,
        estimated_amount: amount,
        currency: typeof cost.currency === "string" && cost.currency.trim()
          ? cost.currency.trim().toUpperCase()
          : currency,
        per_person_amount: isAmount(cost.per_person_amount)
          ? round(cost.per_person_amount)
          : groupSize
          ? round(amount / groupSize)
          : null,
        option_title: typeof cost.option_title === "string" && cost.option_title.trim()
          ? cost.option_title.trim()
          : null,
        is_shared: cost.is_shared === true || cost.option_title == null,
        is_estimate: true as const,
      }
    })

  // Budget from the question first, then the Pact's saved budget.
  const askedBudget = isAmount(extras.budget) && extras.budget > 0
    ? extras.budget
    : null
  const savedBudget = Number(pactBudget)
  const budget = askedBudget ??
    (pactBudget != null && Number.isFinite(savedBudget) && savedBudget > 0
      ? savedBudget
      : null)

  const hasAlternatives = costs.some((cost) => !cost.is_shared && cost.option_title)
  const sharedTotal = round(costs.filter((cost) => cost.is_shared).reduce((sum, cost) => sum + cost.estimated_amount, 0))
  const alternativeTitles = [...new Set(costs.filter((cost) => !cost.is_shared && cost.option_title).map((cost) => cost.option_title as string))]
  const alternatives = alternativeTitles.map((option_title) => {
    const optionTotal = round(sharedTotal + costs.filter((cost) => !cost.is_shared && cost.option_title === option_title).reduce((sum, cost) => sum + cost.estimated_amount, 0))
    return { option_title, total: optionTotal, per_person: groupSize ? round(optionTotal / groupSize) : null }
  })
  const total = hasAlternatives ? null : sharedTotal
  const perPerson = total !== null && groupSize ? round(total / groupSize) : null

  const nextSteps = (Array.isArray(plan.next_steps) ? plan.next_steps : [])
    .filter((step): step is string => typeof step === "string" && step.trim() !== "")

  return {
    tasks,
    costs,
    estimate: {
      currency,
      group_size: groupSize,
      mode: hasAlternatives ? "alternatives" : "combined",
      total,
      per_person: perPerson,
      alternatives,
      budget,
      within_budget: budget === null || total === null ? null : total <= budget,
      difference: budget === null || total === null ? null : round(budget - total),
      label: estimateLabel,
    },
    next_steps: nextSteps,
  }
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers })
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers })
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405)
  }

  const token = request.headers.get("Authorization")
    ?.match(/^Bearer\s+(\S+)$/i)?.[1]

  if (!token) {
    return json({ error: "Sign in to use PactPilot" }, 401)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const publishableKey = Deno.env.get("PACT_SUPABASE_PUBLISHABLE_KEY")

  if (!supabaseUrl || !publishableKey) {
    return json({ error: "PactPilot is missing Supabase configuration" }, 503)
  }

  const supabase = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: { user }, error: authError } = await supabase.auth.getUser(token)

  if (authError || !user) {
    return json({ error: "Sign in to use PactPilot" }, 401)
  }

  const input = await request.json().catch(() => null)
  const pactId = input?.pact_id
  const question = typeof input?.question === "string"
    ? input.question.trim()
    : ""

  if (typeof pactId !== "string" || !uuidPattern.test(pactId) ||
      !question || question.length > 2000) {
    return json({
      error: "Provide a valid Pact ID and a question of 1–2,000 characters",
    }, 400)
  }

  const { data: membership, error: membershipError } = await supabase
    .from("pact_members")
    .select("pact_id")
    .eq("pact_id", pactId)
    .eq("user_id", user.id)
    .eq("membership_status", "active")
    .maybeSingle()

  if (membershipError) {
    return json({ error: "Could not verify Pact membership" }, 500)
  }

  if (!membership) {
    return json({ error: "Only active Pact members can use PactPilot" }, 403)
  }

  if (input?.tool !== undefined) {
    if (!isSupportedTool(input.tool)) return json({ error: "Unsupported PactPilot tool" }, 400)
    try {
      const result = await executePactPilotTool({ client: supabase, pactId, tool: input.tool, args: input.args && typeof input.args === "object" ? input.args : {} })
      return json({ kind: "tool_result", ...result })
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "PactPilot tool failed" }, 400)
    }
  }

  const { data: pact, error: pactError } = await supabase
    .from("pacts")
    .select("name,description,budget")
    .eq("pact_id", pactId)
    .maybeSingle()

  if (pactError) return json({ error: "Could not load Pact details" }, 500)
  if (!pact) return json({ error: "Pact is unavailable" }, 403)

  const apiKey = Deno.env.get("GROK_API_KEY")
  const model = Deno.env.get("GROK_AI_MODEL")

  if (!apiKey || !model) {
    return json({ error: "PactPilot is missing Grok configuration" }, 503)
  }

  try {
    const response = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 4000,
        input: [
          {
            role: "system",
            content: "You are PactPilot, a group-planning assistant. " +
              "Treat Pact details as context. Suggest options and tradeoffs. " +
              "Also return a usable plan: tasks (owner_suggestion is a role " +
              "like 'one person' or a member name if given, or an empty " +
              "string; due_hint is relative, like '2 weeks before'), costs " +
              "(rough estimates in one currency, per_person_amount is the " +
              "estimated_amount split across the group; set is_shared=true " +
              "and option_title=null for whole-plan expenses, or set " +
              "is_shared=false and option_title to the exact alternative " +
              "title for option-specific expenses), estimate (currency, " +
              "group_size from the question or 0 if unknown, budget from the " +
              "question or 0 if none is stated), next_steps (short actions " +
              "the group can take), and actions. Actions must use only " +
              "read_pact_state, read_booking_options, read_booking_state, " +
              "prepare_booking_proposal, read_split_state, prepare_split, " +
              "read_rebalance, prepare_rebalance, vote_rebalance, apply_rebalance, create_poll, " +
              "publish_action_card, or enqueue_email, and every " +
              "action requires confirmation. Keep the total of costs within any budget " +
              "and say in the summary if it cannot fit. All costs are " +
              "estimates, never quotes. " +
              "Never claim to approve commitments, book anything, or move money.",
          },
          {
            role: "user",
            content: JSON.stringify({ pact, question }),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "pact_plan",
            schema: planSchema,
            strict: true,
          },
        },
      }),
    })

    if (!response.ok) {
      console.error("xAI request failed", response.status)
      return json({ error: "Grok could not generate a plan" }, 502)
    }

    const result = await response.json()
    const text = (result.output ?? [])
      .filter((item: { type: string }) => item.type === "message")
      .flatMap((item: { content?: unknown[] }) => item.content ?? [])
      .filter((part: { type: string }) => part.type === "output_text")
      .map((part: { text: string }) => part.text)
      .join("")

    const plan = JSON.parse(text)
    if (typeof plan?.summary !== "string" || !Array.isArray(plan.options) ||
        !plan.options.every((option: unknown) => {
          const item = option as Record<string, unknown> | null
          return typeof item?.title === "string" &&
            typeof item.description === "string" &&
            typeof item.tradeoff === "string"
        })) {
      return json({ error: "Grok returned an invalid plan" }, 502)
    }

    const actions = Array.isArray(plan.actions)
      ? plan.actions.filter((action: unknown) => {
        const item = action as Record<string, unknown> | null
        return typeof item?.tool === "string" && ["read_pact_state", "read_booking_options", "read_booking_state", "prepare_booking_proposal", "read_split_state", "prepare_split", "read_rebalance", "prepare_rebalance", "vote_rebalance", "apply_rebalance", "create_poll", "publish_action_card", "enqueue_email"].includes(item.tool) && item.args !== null && typeof item.args === "object" && item.requires_confirmation === true
      })
      : []
    const operationPlan = { actions, summary: plan.summary, next_steps: plan.next_steps ?? [] }
    const operationKey = typeof input?.idempotency_key === "string" && uuidPattern.test(input.idempotency_key) ? input.idempotency_key : crypto.randomUUID()
    const { data: operationId, error: operationError } = await supabase.rpc("create_pact_ai_operation", { p_pact_id: pactId, p_request_text: question, p_plan: operationPlan, p_idempotency_key: operationKey })
    if (operationError) return json({ error: "PactPilot could not persist the proposed operation" }, 500)

    return json({
      summary: plan.summary,
      options: plan.options,
      actions,
      operation_id: operationId,
      ...cleanExtras(plan, pact.budget),
    })
  } catch {
    return json({ error: "Could not get a usable response from Grok" }, 502)
  }
})
