import { createClient } from "npm:@supabase/supabase-js@2"

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
  required: ["summary", "options"],
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
  },
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
        max_output_tokens: 2500,
        input: [
          {
            role: "system",
            content: "You are PactPilot, a group-planning assistant. " +
              "Treat Pact details as context. Suggest options and tradeoffs. " +
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

    return json({ summary: plan.summary, options: plan.options })
  } catch {
    return json({ error: "Could not get a usable response from Grok" }, 502)
  }
})