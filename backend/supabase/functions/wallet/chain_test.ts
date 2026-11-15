import { assertEquals } from 'jsr:@std/assert@1'
import { decodeOpenPact, PACTS_SELECTOR, pactKey, usdcString, usdcWei } from './chain.ts'

// Replies of pacts(key) as Solidity encodes them (made with cast abi-encode).
const OPEN = '0x000000000000000000000000000000000000000000000000000000000000a11c0000000000000000000000000000000000000000000000000000000000000b0b0000000000000000000000000000000000000000000000015af1d78b58c4000000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000006b49d2000000000000000000000000000000000000000000000000000000000000000001'
const RELEASED = '0x000000000000000000000000000000000000000000000000000000000000a11c0000000000000000000000000000000000000000000000000000000000000b0b0000000000000000000000000000000000000000000000015af1d78b58c4000000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000006b49d2000000000000000000000000000000000000000000000000000000000000000002'

Deno.test('pactKey left-aligns the uuid bytes', () => {
  assertEquals(
    pactKey('123E4567-e89b-12d3-a456-426614174000'),
    '0x123e4567e89b12d3a456426614174000' + '0'.repeat(32),
  )
})

Deno.test('usdcString keeps full precision', () => {
  assertEquals(usdcString(25n * 10n ** 18n), '25')
  assertEquals(usdcString(1_500_000_000_000_000_000n), '1.5')
  assertEquals(usdcString(1n), '0.000000000000000001')
})

Deno.test('usdcWei turns a USDC amount into 18-decimal wei', () => {
  assertEquals(usdcWei('25'), 25n * 10n ** 18n)
  assertEquals(usdcWei('1.50'), 1_500_000_000_000_000_000n)
  assertEquals(usdcWei('0.000001'), 10n ** 12n)
  assertEquals(usdcWei('1.1234567'), null)
  assertEquals(usdcWei('-1'), null)
  assertEquals(usdcWei(25), null)
})

Deno.test('decodeOpenPact reads host, payee, share and share counts of an open pact', () => {
  assertEquals(decodeOpenPact(OPEN), {
    host: '0x000000000000000000000000000000000000a11c',
    payee: '0x0000000000000000000000000000000000000b0b',
    share: 25n * 10n ** 18n,
    sharesNeeded: 4,
    sharesPaid: 1,
  })
})

Deno.test('decodeOpenPact rejects closed, missing and bad replies', () => {
  assertEquals(decodeOpenPact(RELEASED), null)
  assertEquals(decodeOpenPact('0x' + '0'.repeat(64 * 7)), null)
  assertEquals(decodeOpenPact('0x'), null)
  assertEquals(decodeOpenPact(undefined), null)
})

Deno.test('selector is pacts(bytes32)', () => {
  assertEquals(PACTS_SELECTOR, '0xf8bfca8b')
})
