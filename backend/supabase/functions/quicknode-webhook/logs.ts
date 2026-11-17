// Turns QuickNode Stream payloads into PactSplit events. No I/O here, so it is all testable.

export const TOPICS = {
  paid: '0x377c314585d5357a328354ae4fbd2fa0fed0a31de5810d1b3978bcb3a37507e6',
  released: '0xc8fa66dff4b9073528c3f1bf21a8dc9a18fdf09847e88e96188bc953aef519f0',
  refunded: '0xf552ca82e113ac3c539c3d617f29fcd19c172a0c75dad017555c9e109f7fe183',
  cancelled: '0xbaa1eb22f2a492ba1a5fea61b8df4d27c6c8b5f3971e63bb58fa14ff72eedb70',
  created: '0x4bab31bdedd112598af597948003d37acdc3c94059b8b7f68ea7f5b9ed81f09c',
} as const

export type EventKind = keyof typeof TOPICS

export type PactEvent = {
  kind: EventKind
  signature: string
  pactId: string
  address: string | null // payer for paid and refunded, payee for released
  amountUsdc: string | null // up to 6 decimals, as pact_payments stores it
  txHash: string
  logIndex: number
  blockNumber: number | null
}

type RawLog = Record<string, unknown> & { topics: unknown[] }

const kindByTopic = new Map<string, EventKind>(Object.entries(TOPICS).map(([kind, topic]) => [topic, kind as EventKind]))
const word = /^0x[0-9a-f]{64}$/

const isLog = (value: unknown): value is RawLog =>
  typeof value === 'object' && value !== null && Array.isArray((value as RawLog).topics) &&
  typeof (value as RawLog).transactionHash === 'string'

// A Stream can send blocks of logs, a flat list, or whatever a filter returns, so take every log-shaped object.
export function collectLogs(payload: unknown, found: RawLog[] = []): RawLog[] {
  if (isLog(payload)) found.push(payload)
  else if (Array.isArray(payload)) payload.forEach((item) => collectLogs(item, found))
  else if (typeof payload === 'object' && payload !== null) Object.values(payload).forEach((item) => collectLogs(item, found))
  return found
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === 'string' && /^(0x[0-9a-f]+|\d+)$/i.test(value)) {
    const parsed = Number(BigInt(value))
    return Number.isSafeInteger(parsed) ? parsed : null
  }
  return null
}

// PactSplit keys a pact by its 16 uuid bytes, left-aligned, so the right half must be zero.
export function pactIdFromTopic(topic: string): string | null {
  if (!word.test(topic) || !/^0{32}$/.test(topic.slice(34))) return null
  const hex = topic.slice(2, 34)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function addressFromTopic(topic: unknown): string | null {
  return typeof topic === 'string' && word.test(topic.toLowerCase()) ? `0x${topic.toLowerCase().slice(26)}` : null
}

// PactSplit amounts are native USDC with 18 decimals. Anything finer than 6 decimals can't match a share.
export function usdcFromWord(data: unknown): string | null {
  if (typeof data !== 'string' || !/^0x[0-9a-f]{64}/i.test(data)) return null
  const wei = BigInt(data.slice(0, 66))
  if (wei % 10n ** 12n !== 0n) return null
  const micro = wei / 10n ** 12n
  const frac = (micro % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return frac ? `${micro / 1_000_000n}.${frac}` : `${micro / 1_000_000n}`
}

export function decodeLog(log: RawLog, contract: string): PactEvent | null {
  if (log.removed === true) return null // dropped in a reorg
  if (typeof log.address !== 'string' || log.address.toLowerCase() !== contract.toLowerCase()) return null
  const topics = log.topics.map((topic) => typeof topic === 'string' ? topic.toLowerCase() : '')
  const kind = kindByTopic.get(topics[0])
  const pactId = topics[1] ? pactIdFromTopic(topics[1]) : null
  const txHash = (log.transactionHash as string).toLowerCase()
  const logIndex = toNumber(log.logIndex)
  if (!kind || !pactId || !/^0x[0-9a-f]{64}$/.test(txHash) || logIndex === null) return null
  const hasAmount = kind === 'paid' || kind === 'released' || kind === 'refunded'
  const amountUsdc = hasAmount ? usdcFromWord(log.data) : null
  const address = hasAmount ? addressFromTopic(topics[2]) : null
  if (hasAmount && (!amountUsdc || !address)) return null
  return { kind, signature: topics[0], pactId, address, amountUsdc, txHash, logIndex, blockNumber: toNumber(log.blockNumber) }
}

// Oldest first, so a SharePaid lands before the Released in the same batch.
export function pactEvents(payload: unknown, contract: string): PactEvent[] {
  return collectLogs(payload)
    .map((log) => decodeLog(log, contract))
    .filter((event): event is PactEvent => event !== null)
    .sort((a, b) => (a.blockNumber ?? 0) - (b.blockNumber ?? 0) || a.logIndex - b.logIndex)
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

// QuickNode signs each delivery with the Stream's security token: HMAC-SHA256 over nonce + timestamp + body.
export async function validSignature(token: string, nonce: string, timestamp: string, body: string, signature: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(nonce + timestamp + body)))
  const given = signature.trim().toLowerCase().replace(/^0x/, '')
  if (given.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i)
  return diff === 0
}
