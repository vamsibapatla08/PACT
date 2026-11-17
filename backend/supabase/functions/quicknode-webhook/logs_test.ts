import { assertEquals } from 'jsr:@std/assert@1'
import { collectLogs, pactEvents, pactIdFromTopic, TOPICS, usdcFromWord, validSignature } from './logs.ts'

const CONTRACT = '0x6eadb2b3829e6d9c30208ff4122c40df7682d79d'
const PACT_TOPIC = '0x123e4567e89b12d3a456426614174000' + '0'.repeat(32)
const PAYER = '0x5D56000000000000000000000000000000007748'
const payerTopic = '0x' + '0'.repeat(24) + PAYER.slice(2).toLowerCase()
const oneUsdc = '0x' + (10n ** 18n).toString(16).padStart(64, '0')
const tx = (n: number) => '0x' + n.toString(16).padStart(64, '0')

const log = (topics: string[], data: string, logIndex: string, extra: Record<string, unknown> = {}) => ({
  address: CONTRACT.toUpperCase().replace('0X', '0x'), topics, data, transactionHash: tx(1), logIndex, blockNumber: '0x10', ...extra,
})

Deno.test('pactIdFromTopic puts the dashes back and refuses a non-pact key', () => {
  assertEquals(pactIdFromTopic(PACT_TOPIC), '123e4567-e89b-12d3-a456-426614174000')
  assertEquals(pactIdFromTopic('0x' + '1'.repeat(64)), null)
})

Deno.test('usdcFromWord turns 18-decimal wei into a 6-decimal amount', () => {
  assertEquals(usdcFromWord(oneUsdc), '1')
  assertEquals(usdcFromWord('0x' + (25n * 10n ** 17n).toString(16).padStart(64, '0')), '2.5')
  assertEquals(usdcFromWord('0x' + 1n.toString(16).padStart(64, '0')), null)
})

Deno.test('collectLogs finds logs however the Stream nests them', () => {
  const one = log([TOPICS.cancelled, PACT_TOPIC], '0x', '0x0')
  assertEquals(collectLogs([[one], [one]]).length, 2)
  assertEquals(collectLogs({ data: [[one]] }).length, 1)
  assertEquals(collectLogs({ matchingLogs: [one] }).length, 1)
})

Deno.test('pactEvents decodes PactSplit events in order and drops the rest', () => {
  const events = pactEvents([[
    log([TOPICS.released, PACT_TOPIC, payerTopic], oneUsdc, '0x2'),
    log([TOPICS.paid, PACT_TOPIC, payerTopic], oneUsdc, '0x1'),
    log([TOPICS.paid, PACT_TOPIC, payerTopic], oneUsdc, '0x3', { removed: true }),
    log([TOPICS.paid, PACT_TOPIC, payerTopic], oneUsdc, '0x4', { address: '0x3600000000000000000000000000000000000000' }),
    log(['0x' + 'a'.repeat(64), PACT_TOPIC], oneUsdc, '0x5'),
  ]], CONTRACT)
  assertEquals(events.map((event) => [event.kind, event.logIndex]), [['paid', 1], ['released', 2]])
  assertEquals(events[0], {
    kind: 'paid', signature: TOPICS.paid, pactId: '123e4567-e89b-12d3-a456-426614174000', address: PAYER.toLowerCase(),
    amountUsdc: '1', txHash: tx(1), logIndex: 1, blockNumber: 16,
  })
})

Deno.test('Cancelled has no payer or amount', () => {
  const [event] = pactEvents([log([TOPICS.cancelled, PACT_TOPIC], '0x', '0x0')], CONTRACT)
  assertEquals([event.kind, event.address, event.amountUsdc], ['cancelled', null, null])
})

Deno.test('validSignature checks the HMAC over nonce, timestamp and body', async () => {
  const body = '{"data":[]}'
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('n1' + '1700000000' + body)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('')
  assertEquals(await validSignature('secret', 'n1', '1700000000', body, mac), true)
  assertEquals(await validSignature('wrong', 'n1', '1700000000', body, mac), false)
  assertEquals(await validSignature('secret', 'n1', '1700000000', body + ' ', mac), false)
})
