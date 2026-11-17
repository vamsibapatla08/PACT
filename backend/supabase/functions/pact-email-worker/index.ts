import { createClient } from "npm:@supabase/supabase-js@2"

type OutboxRow = {
  email_id: string
  pact_id: string
  recipient_user_id: string
  email_type: string
  payload: Record<string, unknown>
  attempts: number
}

const json = (body: unknown, status = 200) => Response.json(body, { status })

async function tokenMatches(supplied: string, expected: string) {
  const encoder = new TextEncoder()
  const [suppliedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ])
  const suppliedBytes = new Uint8Array(suppliedDigest)
  const expectedBytes = new Uint8Array(expectedDigest)
  let difference = suppliedBytes.length ^ expectedBytes.length
  for (let index = 0; index < Math.max(suppliedBytes.length, expectedBytes.length); index += 1) {
    difference |= (suppliedBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0)
  }
  return difference === 0
}

async function deliver(row: OutboxRow) {
  const provider = Deno.env.get("EMAIL_PROVIDER") ?? "resend"
  if (provider === "mock") return { provider_ack: `mock:${row.email_id}` }
  const apiKey = Deno.env.get("RESEND_API_KEY")
  const from = Deno.env.get("PACT_EMAIL_FROM")
  if (!apiKey || !from) throw new Error("Email provider is not configured")
  const recipient = typeof row.payload.recipient_email === "string" ? row.payload.recipient_email : ""
  if (!recipient) throw new Error("Outbox item has no authorized recipient email")
  const subject = row.email_type === "demo_itinerary" ? "Your PACT demo itinerary" : "Your verified PACT payment receipt"
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [recipient], subject, text: `${subject}\n\nThis is a PACT demo message.`, headers: { "X-Entity-Id": row.email_id } }),
  })
  if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}`)
  const result = await response.json()
  return { provider_ack: typeof result?.id === "string" ? result.id : "accepted" }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405)
  const workerToken = Deno.env.get("PACT_EMAIL_WORKER_TOKEN")
  const suppliedToken = request.headers.get("Authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!workerToken || !suppliedToken || !(await tokenMatches(suppliedToken, workerToken))) return json({ error: "Unauthorized" }, 401)
  const url = Deno.env.get("SUPABASE_URL")
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !key) return json({ error: "Email worker is missing server configuration" }, 503)
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: rows, error } = await db.from("pact_email_outbox").select("email_id,pact_id,recipient_user_id,email_type,payload,attempts").in("status", ["pending", "failed"]).lte("next_attempt_at", new Date().toISOString()).order("created_at").limit(10)
  if (error) return json({ error: "Could not load email outbox" }, 500)
  const results: Array<{ email_id: string; status: string }> = []
  for (const row of (rows ?? []) as OutboxRow[]) {
    const { data: claimed } = await db.from("pact_email_outbox").update({ status: "processing", updated_at: new Date().toISOString() }).eq("email_id", row.email_id).in("status", ["pending", "failed"]).select("email_id").maybeSingle()
    if (!claimed) continue
    try {
      if (typeof row.payload.recipient_email !== "string") {
        const { data: recipient, error: recipientError } = await db.auth.admin.getUserById(row.recipient_user_id)
        if (recipientError || !recipient.user?.email) throw new Error("Authorized recipient email is unavailable")
        row.payload = { ...row.payload, recipient_email: recipient.user.email }
      }
      const delivered = await deliver(row)
      await db.from("pact_email_outbox").update({ status: "sent", provider_message_id: delivered.provider_ack, updated_at: new Date().toISOString() }).eq("email_id", row.email_id).eq("status", "processing")
      results.push({ email_id: row.email_id, status: "sent" })
    } catch (reason) {
      const nextAttempt = new Date(Date.now() + Math.min(60 * 60_000, 2 ** Math.min(row.attempts + 1, 10) * 30_000)).toISOString()
      await db.from("pact_email_outbox").update({ status: "failed", last_error: reason instanceof Error ? reason.message : "Email delivery failed", attempts: row.attempts + 1, next_attempt_at: nextAttempt, updated_at: new Date().toISOString() }).eq("email_id", row.email_id).eq("status", "processing")
      results.push({ email_id: row.email_id, status: "failed" })
    }
  }
  return json({ processed: results.length, results })
})
