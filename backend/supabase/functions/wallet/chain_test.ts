import { assertEquals } from 'jsr:@std/assert@1'
import {
  challengeOutcome, closeBlocker, CONTRACT_GAS, decodeBool, decodePact, gasReserve, lowBalance, type MemberPaid,
  PAID_SELECTOR, paidCallData, PACTS_SELECTOR, pactKey, pactStatusView, payShareBlocker, PIN_MARGIN_SECONDS,
  refundBlocker, txOutcome, usdcString, usdcWei,
} from './chain.ts'

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

Deno.test('decodePact reads a released pact and rejects missing and bad replies', () => {
  assertEquals(decodePact(RELEASED)?.state, 'released')
  assertEquals(decodePact('0x'), null)
  assertEquals(decodePact(undefined), null)
})

Deno.test('selector is pacts(bytes32)', () => {
  assertEquals(PACTS_SELECTOR, '0xf8bfca8b')
})

// pacts(key) replies with 4 shares needed, as cast abi-encode gives them, varying sharesPaid and state.
const reply = (sharesPaid: number, state: number) =>
  OPEN.slice(0, 2 + 64 * 4) + sharesPaid.toString(16).padStart(64, '0') + OPEN.slice(2 + 64 * 5, 2 + 64 * 6) +
  state.toString(16).padStart(64, '0')

Deno.test('fixture builder matches cast abi-encode', () => {
  assertEquals(reply(1, 1), OPEN)
  assertEquals(reply(4, 2), RELEASED)
})

Deno.test('decodePact names every State value', () => {
  assertEquals(decodePact('0x' + '0'.repeat(64 * 7))?.state, 'none')
  assertEquals(decodePact(reply(1, 1))?.state, 'open')
  assertEquals(decodePact(reply(4, 2))?.state, 'released')
  assertEquals(decodePact(reply(2, 3))?.state, 'cancelled')
  assertEquals(decodePact(reply(1, 4)), null) // not a State
  assertEquals(decodePact('0x'), null)
  assertEquals(decodePact(undefined), null)
  assertEquals(decodePact('0x' + 'zz'.repeat(32 * 7)), null)
})

Deno.test('decodePact reads every field', () => {
  assertEquals(decodePact(RELEASED), {
    host: '0x000000000000000000000000000000000000a11c',
    payee: '0x0000000000000000000000000000000000000b0b',
    share: 25n * 10n ** 18n,
    sharesNeeded: 4,
    sharesPaid: 4,
    deadline: 1_800_000_000,
    state: 'released',
  })
})

Deno.test('paid(bytes32,address) call data matches cast calldata', () => {
  assertEquals(PAID_SELECTOR, '0xd76f8e80')
  assertEquals(
    paidCallData(pactKey('123e4567-e89b-12d3-a456-426614174000'), '0x000000000000000000000000000000000000BEEF'),
    '0xd76f8e80123e4567e89b12d3a45642661417400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000beef',
  )
})

Deno.test('decodeBool reads a bool reply', () => {
  assertEquals(decodeBool('0x' + '0'.repeat(63) + '1'), true)
  assertEquals(decodeBool('0x' + '0'.repeat(64)), false)
  assertEquals(decodeBool('0x' + '0'.repeat(63) + '2'), null)
  assertEquals(decodeBool('0x'), null)
  assertEquals(decodeBool(undefined), null)
})

const HOST = '0x000000000000000000000000000000000000A11C' // checksum case, as the wallets table may hold it
const OTHER = '0x0000000000000000000000000000000000000bad'
const members = (paid: boolean[]): MemberPaid[] =>
  paid.map((p, i) => ({ userId: `user-${i}`, role: i === 0 ? 'host' : 'member', address: `0x${'0'.repeat(39)}${i}`, paid: p }))
const view = (sharesPaid: number, state: number, paid: boolean[]) =>
  pactStatusView('pact-1', '0xcontract', decodePact(reply(sharesPaid, state))!, members(paid), HOST)

Deno.test('pact_status: open and part paid is not funded, lists payers and amounts', () => {
  const v = view(2, 1, [true, false, true, false])
  assertEquals(v.state, 'open')
  assertEquals(v.funded, false)
  assertEquals([v.sharesPaid, v.sharesNeeded], [2, 4])
  assertEquals(v.openedByHost, true)
  assertEquals(v.share, { usdc: '25', wei: '25000000000000000000' })
  assertEquals(v.total, { usdc: '100', wei: '100000000000000000000' })
  assertEquals(v.paidIn, { usdc: '50', wei: '50000000000000000000' })
  assertEquals(v.payers.map((p) => p.userId), ['user-0', 'user-2'])
  assertEquals(v.payers[0].amount.usdc, '25')
  assertEquals(v.otherPayers, 0)
  assertEquals(v.deadlineAt, '2027-01-15T08:00:00.000Z')
})

Deno.test('pact_status: open and full is funded; released stays funded', () => {
  assertEquals(view(4, 1, [true, true, true, true]).funded, true)
  assertEquals(view(4, 2, [true, true, true, true]).funded, true)
})

Deno.test('pact_status: cancelled is never funded, payers are who has not claimed a refund', () => {
  const v = view(4, 3, [false, true, false, false])
  assertEquals(v.state, 'cancelled')
  assertEquals(v.funded, false)
  assertEquals(v.payers.map((p) => p.userId), ['user-1'])
  assertEquals(v.otherPayers, 0)
})

Deno.test('pact_status: shares paid from non-member wallets are counted', () => {
  assertEquals(view(3, 1, [true, false, false, false]).otherPayers, 2)
})

Deno.test('pact_status: a pact never opened reads as none with zeros', () => {
  const v = pactStatusView('pact-1', '0xcontract', decodePact('0x' + '0'.repeat(64 * 7))!, members([false]), HOST)
  assertEquals(v.state, 'none')
  assertEquals(v.onChain, false)
  assertEquals(v.funded, false)
  assertEquals([v.host, v.payee, v.openedByHost, v.deadline, v.deadlineAt], [null, null, null, null, null])
  assertEquals([v.sharesPaid, v.sharesNeeded, v.payers.length], [0, 0, 0])
  assertEquals(v.total, { usdc: '0', wei: '0' })
})

Deno.test('pact_status: a pact opened from another wallet is flagged', () => {
  const pact = decodePact(OPEN)!
  assertEquals(pactStatusView('p', '0xc', pact, [], '0x' + '1'.repeat(40)).openedByHost, false)
  assertEquals(pactStatusView('p', '0xc', pact, [], null).openedByHost, false)
})

// The OPEN fixture: 4 shares of 25 USDC, 1 paid, deadline 1_800_000_000.
const DEADLINE = 1_800_000_000
const EARLY = DEADLINE - 3600

Deno.test('payShareBlocker lets an open pact with room through', () => {
  assertEquals(payShareBlocker(decodePact(reply(1, 1))!, false, EARLY), null)
})

Deno.test('payShareBlocker stops every case PactSplit reverts on, before the PIN', () => {
  assertEquals(payShareBlocker(decodePact(reply(4, 2))!, false, EARLY), 'This pact is not open for payment')
  assertEquals(payShareBlocker(decodePact(reply(2, 3))!, false, EARLY), 'This pact is not open for payment')
  assertEquals(payShareBlocker(decodePact('0x' + '0'.repeat(64 * 7))!, false, EARLY), 'This pact is not open for payment')
  assertEquals(payShareBlocker(decodePact(reply(1, 1))!, true, EARLY), 'You already paid your share of this pact')
  assertEquals(payShareBlocker(decodePact(reply(4, 1))!, false, EARLY), 'Every share of this pact is already paid')
  assertEquals(payShareBlocker(decodePact(reply(1, 1))!, false, DEADLINE + 1), 'The deadline to pay into this pact has passed')
  // Too close to the deadline for the PIN step and the block to land in time.
  assertEquals(
    payShareBlocker(decodePact(reply(1, 1))!, false, DEADLINE - PIN_MARGIN_SECONDS + 1),
    'The deadline to pay into this pact has passed',
  )
})

Deno.test('payShareBlocker refuses a share finer than the 6 decimals Circle sends', () => {
  const pact = { ...decodePact(reply(1, 1))!, share: 25n * 10n ** 18n + 1n }
  assertEquals(payShareBlocker(pact, false, EARLY), 'This pact asks for a share Circle cannot send')
})

Deno.test('refundBlocker: only a payer of a cancelled pact can claim', () => {
  assertEquals(refundBlocker(decodePact(reply(2, 3))!, true), null)
  assertEquals(refundBlocker(decodePact(reply(2, 3))!, false), 'You have no share to refund in this pact')
  assertEquals(refundBlocker(decodePact(reply(2, 1))!, true), 'Refunds open only after the pact is cancelled')
  assertEquals(refundBlocker(decodePact(reply(4, 2))!, true), 'Refunds open only after the pact is cancelled')
})

Deno.test('gasReserve doubles the gas price over the gas budget', () => {
  assertEquals(gasReserve(160n * 10n ** 9n, CONTRACT_GAS), 48n * 10n ** 15n) // 0.048 USDC
})

Deno.test('lowBalance passes a balance that covers value plus gas', () => {
  const share = 25n * 10n ** 18n
  const gas = 48n * 10n ** 15n
  assertEquals(lowBalance(share + gas, share, gas), null)
  assertEquals(lowBalance(100n * 10n ** 18n, share, gas), null)
})

Deno.test('lowBalance explains a shortfall in USDC, counting gas', () => {
  const share = 25n * 10n ** 18n
  const gas = 48n * 10n ** 15n
  assertEquals(
    lowBalance(25n * 10n ** 18n, share, gas),
    'Not enough USDC: this needs 25.048 USDC (25 plus up to 0.048 for gas) and your wallet has 25. Add at least 0.048 USDC.',
  )
  // Enough for the share alone is still short once gas counts; dust is rounded up so the advice is enough.
  assertEquals(
    lowBalance(0n, 0n, 1n),
    'Not enough USDC: this needs 0.000001 USDC (0 plus up to 0.000001 for gas) and your wallet has 0. Add at least 0.000001 USDC.',
  )
})

Deno.test('challengeOutcome maps Circle challenge states', () => {
  assertEquals(challengeOutcome('COMPLETE'), 'complete')
  assertEquals(challengeOutcome('FAILED'), 'failed')
  assertEquals(challengeOutcome('EXPIRED'), 'failed')
  assertEquals(challengeOutcome('PENDING'), 'awaiting_pin')
  assertEquals(challengeOutcome('IN_PROGRESS'), 'awaiting_pin')
  assertEquals(challengeOutcome(undefined), 'awaiting_pin')
})

Deno.test('txOutcome: Circle failures are failed whatever the receipt says', () => {
  for (const state of ['FAILED', 'CANCELLED', 'DENIED']) {
    assertEquals(txOutcome(state, null), 'failed')
    assertEquals(txOutcome(state, '0x1'), 'failed')
  }
})

Deno.test('txOutcome: confirmed only with a success receipt; a revert is failed', () => {
  assertEquals(txOutcome('CONFIRMED', '0x1'), 'confirmed')
  assertEquals(txOutcome('COMPLETE', '0x1'), 'confirmed')
  assertEquals(txOutcome('CONFIRMED', '0x0'), 'failed')
  assertEquals(txOutcome('COMPLETE', '0x0'), 'failed')
  assertEquals(txOutcome('CONFIRMED', null), 'pending') // receipt not visible on the RPC yet
})

Deno.test('txOutcome: in-flight states are pending', () => {
  for (const state of ['INITIATED', 'PENDING_RISK_SCREENING', 'QUEUED', 'SENT', 'STUCK', undefined]) {
    assertEquals(txOutcome(state, null), 'pending')
  }
})

Deno.test('closeBlocker: only the host who opened it releases, and only once full', () => {
  assertEquals(closeBlocker('release', decodePact(reply(4, 1))!, true, HOST, EARLY), null)
  assertEquals(closeBlocker('release', decodePact(reply(3, 1))!, true, HOST, EARLY), 'Waiting for 1 more of 4 shares')
  assertEquals(closeBlocker('release', decodePact(reply(4, 1))!, false, HOST, EARLY), 'Only the host can do this')
  assertEquals(closeBlocker('release', decodePact(reply(4, 1))!, true, OTHER, EARLY), 'This pact was opened from another wallet')
  assertEquals(closeBlocker('release', decodePact(reply(4, 2))!, true, HOST, EARLY), 'This pact is not open')
})

Deno.test('closeBlocker: the host cancels any time, any member only after the deadline', () => {
  assertEquals(closeBlocker('cancel', decodePact(reply(1, 1))!, true, HOST, EARLY), null)
  assertEquals(closeBlocker('cancel', decodePact(reply(1, 1))!, false, OTHER, EARLY), 'Only the host can cancel before the deadline')
  assertEquals(closeBlocker('cancel', decodePact(reply(1, 1))!, false, OTHER, DEADLINE), 'Only the host can cancel before the deadline')
  assertEquals(closeBlocker('cancel', decodePact(reply(1, 1))!, false, OTHER, DEADLINE + 1), null)
  assertEquals(closeBlocker('cancel', decodePact(reply(1, 3))!, false, OTHER, DEADLINE + 1), 'This pact is not open')
})
