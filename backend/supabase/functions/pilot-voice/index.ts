// Pact Pilot's voice: turns an answer into speech with ElevenLabs and returns the audio. Signed-in people only.
// The ElevenLabs key stays here, as a secret; the app never sees it.
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
const API_KEY = Deno.env.get('ELEVENLABS_API_KEY')
// A clear, neutral default voice; set ELEVENLABS_VOICE_ID to pick another from your ElevenLabs voice library.
const VOICE_ID = Deno.env.get('ELEVENLABS_VOICE_ID') ?? '21m00Tcm4TlvDq8ikWAM'
// The quick, low-latency model, so the answer starts playing fast.
const MODEL_ID = Deno.env.get('ELEVENLABS_MODEL_ID') ?? 'eleven_flash_v2_5'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return reply({ error: 'Use POST' }, 405)
  const token = req.headers.get('Authorization')?.replace(/^Bearer /, '')
  const user = token ? (await admin.auth.getUser(token).catch(() => null))?.data.user : null
  if (!user) return reply({ error: 'Sign in first' }, 401)
  if (!API_KEY) return reply({ error: "Pact Pilot's voice isn't set up yet." }, 503)

  const body = await req.json().catch(() => ({})) as { text?: unknown }
  // Speak the words, not the markdown.
  const text = typeof body.text === 'string' ? body.text.replace(/[*_#`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 1200) : ''
  if (!text) return reply({ error: 'Nothing to say.' }, 400)

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: MODEL_ID }),
  }).catch(() => null)
  if (!res?.ok) {
    console.error('[pilot-voice] ElevenLabs', res?.status, await res?.text().catch(() => ''))
    return reply({ error: "Pact Pilot's voice isn't available right now." }, 502)
  }
  return new Response(res.body, { status: 200, headers: { ...cors, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } })
})
