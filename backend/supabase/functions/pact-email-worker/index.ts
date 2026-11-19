import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"

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

// deno-lint-ignore no-explicit-any
type Db = SupabaseClient<any>
type Email = { subject: string; text: string; html: string }

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!))
const money = (n: unknown) => n != null && Number.isFinite(Number(n)) ? `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ""
const day = (d: string | null) => d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : ""
const dates = (a: string | null, b: string | null) => a ? (b && b !== a ? `${day(a)} to ${day(b)}` : day(a)) : ""

function page(title: string, lines: string[], appUrl: string, pactId: string) {
  const body = lines.map((l) => `<div style="margin:0 0 10px">${l}</div>`).join("")
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">` +
    `<h2 style="margin:0 0 16px">${esc(title)}</h2>${body}` +
    `<p style="margin:20px 0 0"><a href="${esc(appUrl)}/pacts/${esc(pactId)}" style="background:#111;color:#fff;padding:10px 16px;border-radius:999px;text-decoration:none">Open the pact</a></p>` +
    `<p style="margin:24px 0 0;color:#888;font-size:12px">Sent by Pact because you're in this pact.</p></div>`
}

type ItemRow = { title: string; starts_on: string | null; ends_on: string | null; price_each: number | null; extra?: boolean }

/** What the email says, built from the database at send time so it's never stale. */
async function compose(db: Db, row: OutboxRow): Promise<Email> {
  const appUrl = (Deno.env.get("PACT_APP_URL") ?? "https://pact-chi-nine.vercel.app").replace(/\/$/, "")
  const { data: pact } = await db.from("pacts").select("name,location,starts_on,ends_on").eq("pact_id", row.pact_id).maybeSingle()
  const name = (pact?.name as string | undefined) ?? "Your pact"
  if (row.email_type === "pact_booked") {
    const [{ data: items }, { data: payment }] = await Promise.all([
      db.from("pact_items").select("title,starts_on,ends_on,price_each,extra").eq("pact_id", row.pact_id).order("starts_on", { nullsFirst: false }),
      db.from("pact_payments").select("share_usdc,shares_needed").eq("pact_id", row.pact_id).maybeSingle(),
    ])
    const plan = ((items ?? []) as ItemRow[]).filter((i) => !i.extra)
    const when = dates((pact?.starts_on as string | null) ?? null, (pact?.ends_on as string | null) ?? null)
    const share = payment ? money(payment.share_usdc) : ""
    const total = payment ? money(Number(payment.share_usdc) * Number(payment.shares_needed)) : ""
    const head = [pact?.location as string | null, when].filter(Boolean).join(" · ")
    const itemLines = plan.map((i) => [i.title, dates(i.starts_on, i.ends_on), i.price_each != null ? `${money(i.price_each)} each` : ""].filter(Boolean).join(" · "))
    const intro = `Everyone paid, and ${name} is booked.`
    const paid = share ? `You paid ${share}${total ? ` of the ${total} total` : ""}.` : ""
    return {
      subject: `You're booked: ${name}`,
      text: [intro, head, ...itemLines.map((l) => `- ${l}`), paid, `${appUrl}/pacts/${row.pact_id}`].filter(Boolean).join("\n"),
      html: page(`You're booked: ${name}`, [
        esc(intro), head ? `<b>${esc(head)}</b>` : "",
        itemLines.length ? `<ul style="padding-left:18px;margin:0">${itemLines.map((l) => `<li style="margin:0 0 6px">${esc(l)}</li>`).join("")}</ul>` : "",
        esc(paid),
      ].filter(Boolean), appUrl, row.pact_id),
    }
  }
  if (row.email_type === "verified_payment_receipt") {
    const amount = money(row.payload.amount_usdc)
    const line = `Your share${amount ? ` of ${amount}` : ""} for ${name} is in. It's held in the pact until everyone has paid.`
    return { subject: `Payment received: ${name}`, text: `${line}\n${appUrl}/pacts/${row.pact_id}`, html: page("Payment received", [esc(line)], appUrl, row.pact_id) }
  }
  const line = `Here are the details for ${name}.`
  return { subject: `Your Pact itinerary: ${name}`, text: `${line}\n${appUrl}/pacts/${row.pact_id}`, html: page(`Your itinerary: ${name}`, [esc(line)], appUrl, row.pact_id) }
}

async function deliver(db: Db, row: OutboxRow) {
  const provider = Deno.env.get("EMAIL_PROVIDER") ?? "resend"
  if (provider === "mock") return { provider_ack: `mock:${row.email_id}` }
  const apiKey = Deno.env.get("RESEND_API_KEY")
  const from = Deno.env.get("PACT_EMAIL_FROM")
  if (!apiKey || !from) throw new Error("Email provider is not configured")
  const recipient = typeof row.payload.recipient_email === "string" ? row.payload.recipient_email : ""
  if (!recipient) throw new Error("Outbox item has no authorized recipient email")
  const email = await compose(db, row)
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": row.email_id },
    body: JSON.stringify({ from, to: [recipient], subject: email.subject, text: email.text, html: email.html, headers: { "X-Entity-Id": row.email_id } }),
  })
  if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`)
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
      const delivered = await deliver(db, row)
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
