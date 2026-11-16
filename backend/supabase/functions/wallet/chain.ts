// Pure helpers for talking to PactSplit on Arc. No imports, so they test without the Edge runtime.

// Full-precision decimal string of an 18-decimal amount, which is the form Circle takes amounts in.
export function usdcString(wei: bigint) {
  const frac = (wei % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '')
  return frac ? `${wei / 10n ** 18n}.${frac}` : `${wei / 10n ** 18n}`
}

// A USDC amount like "25.50" (up to 6 decimals) as the 18-decimal wei PactSplit stores. Null if not one.
export function usdcWei(amount: unknown): bigint | null {
  if (typeof amount !== 'string' || !/^\d+(\.\d{1,6})?$/.test(amount)) return null
  const [whole, frac = ''] = amount.split('.')
  return BigInt(whole) * 10n ** 18n + BigInt(frac.padEnd(18, '0'))
}

// A pact's uuid as the bytes32 key PactSplit stores it under: the 16 uuid bytes, left-aligned.
export function pactKey(pactId: string) {
  return `0x${pactId.replace(/-/g, '').toLowerCase()}${'0'.repeat(32)}`
}

export const PACTS_SELECTOR = '0xf8bfca8b' // pacts(bytes32)

export const PAID_SELECTOR = '0xd76f8e80' // paid(bytes32,address)

// PactSplit's State enum in order, named like payment_status in the app.
export const PACT_STATES = ['none', 'open', 'released', 'cancelled'] as const
export type PactState = typeof PACT_STATES[number]

export type OnChainPact = { host: string; payee: string; share: bigint; sharesNeeded: number; sharesPaid: number }
export type PactRecord = OnChainPact & { deadline: number; state: PactState }

// Decodes the eth_call reply of pacts(key) in any state. A pact never opened comes back all zero, state "none".
// Null if the reply is not a pacts() reply.
export function decodePact(result: unknown): PactRecord | null {
  if (typeof result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(result) || result.length < 2 + 64 * 7) return null
  const word = (i: number) => result.slice(2 + 64 * i, 2 + 64 * (i + 1))
  // Words: host, payee, share, sharesNeeded, sharesPaid, deadline, state.
  const state = PACT_STATES[Number(BigInt('0x' + word(6)))]
  if (!state) return null
  return {
    host: '0x' + word(0).slice(24),
    payee: '0x' + word(1).slice(24),
    share: BigInt('0x' + word(2)),
    sharesNeeded: Number(BigInt('0x' + word(3))),
    sharesPaid: Number(BigInt('0x' + word(4))),
    deadline: Number(BigInt('0x' + word(5))),
    state,
  }
}

// Call data for paid(key, address).
export function paidCallData(key: string, address: string) {
  return PAID_SELECTOR + key.slice(2) + address.slice(2).toLowerCase().padStart(64, '0')
}

// Decodes an eth_call reply holding one bool. Null if it is not one.
export function decodeBool(result: unknown): boolean | null {
  if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result)) return null
  const value = BigInt(result)
  return value === 0n ? false : value === 1n ? true : null
}

export type MemberPaid = { userId: string; role: string; address: string | null; paid: boolean }

const amount = (wei: bigint) => ({ usdc: usdcString(wei), wei: wei.toString() })

// The pact_status reply. PactSplit keeps no list of payers, so each member's `paid` is paid(key, their wallet).
// After a cancel, a payer who claimed their refund reads unpaid again, so `payers` is who still has a share in.
// otherPayers: shares paid from wallets that are not a member's (open or released only).
// funded: every share is in and was not refunded, so open and full, or released.
export function pactStatusView(
  pactId: string, contract: string, pact: PactRecord, members: MemberPaid[], hostAddress: string | null,
) {
  const onChain = pact.state !== 'none'
  const payers = members.filter((m) => m.paid)
  return {
    pactId,
    contract,
    state: pact.state,
    onChain,
    host: onChain ? pact.host : null,
    payee: onChain ? pact.payee : null,
    openedByHost: onChain ? hostAddress !== null && pact.host.toLowerCase() === hostAddress.toLowerCase() : null,
    deadline: onChain ? pact.deadline : null,
    deadlineAt: onChain ? new Date(pact.deadline * 1000).toISOString() : null,
    sharesPaid: pact.sharesPaid,
    sharesNeeded: pact.sharesNeeded,
    funded: (pact.state === 'open' || pact.state === 'released') && pact.sharesPaid >= pact.sharesNeeded,
    share: amount(pact.share),
    total: amount(pact.share * BigInt(pact.sharesNeeded)),
    paidIn: amount(pact.share * BigInt(pact.sharesPaid)),
    payers: payers.map((m) => ({ userId: m.userId, address: m.address, amount: amount(pact.share) })),
    members,
    otherPayers: pact.state === 'cancelled' ? 0 : Math.max(0, pact.sharesPaid - payers.length),
  }
}

// Seconds a PIN step and the block after it may take. A deadline closer than this would revert by the time it lands.
export const PIN_MARGIN_SECONDS = 120

// Gas units budgeted per call: PactSplit calls stay well under 150k, a plain send is 21k.
export const CONTRACT_GAS = 150_000n
export const TRANSFER_GAS = 21_000n

// The most gas a call may cost: the gas price doubled for the MEDIUM fee level's headroom, times the gas budget.
export function gasReserve(gasPriceWei: bigint, gasLimit: bigint) {
  return gasPriceWei * 2n * gasLimit
}

// A clear error when the wallet can't cover `valueWei` plus gas, so the user isn't asked for a PIN for a send
// that fails. Null when it can.
export function lowBalance(balanceWei: bigint, valueWei: bigint, gasWei: bigint): string | null {
  const need = valueWei + gasWei
  if (balanceWei >= need) return null
  const up = (wei: bigint) => usdcString(((wei + 10n ** 12n - 1n) / 10n ** 12n) * 10n ** 12n) // rounded up to 6 decimals
  const down = (wei: bigint) => usdcString((wei / 10n ** 12n) * 10n ** 12n)
  return `Not enough USDC: this needs ${up(need)} USDC (${usdcString(valueWei)} plus up to ${up(gasWei)} for gas) ` +
    `and your wallet has ${down(balanceWei)}. Add at least ${up(need - balanceWei)} USDC.`
}

// Why payShare(key) would revert, checked in PactSplit's own order, so no PIN is asked for a tx that fails.
// Null when it would go through.
export function payShareBlocker(pact: PactRecord, alreadyPaid: boolean, nowSeconds: number): string | null {
  if (pact.state !== 'open') return 'This pact is not open for payment'
  if (nowSeconds + PIN_MARGIN_SECONDS > pact.deadline) return 'The deadline to pay into this pact has passed'
  if (alreadyPaid) return 'You already paid your share of this pact'
  if (pact.sharesPaid >= pact.sharesNeeded) return 'Every share of this pact is already paid'
  // Circle takes USDC amounts with at most 6 decimals; a finer share could not be sent exactly.
  if (pact.share % 10n ** 12n !== 0n) return 'This pact asks for a share Circle cannot send'
  return null
}

// Why claimRefund(key) would revert. Null when it would go through.
export function refundBlocker(pact: PactRecord, paid: boolean): string | null {
  if (pact.state !== 'cancelled') return 'Refunds open only after the pact is cancelled'
  if (!paid) return 'You have no share to refund in this pact'
  return null
}

// Why release(key) or cancel(key) from `wallet` would revert, or the app should refuse it. Null when it would go through.
// Only the host releases. The host cancels any time; PactSplit lets anyone cancel after the deadline, so any member
// can too, and shares never stay stuck if the host disappears.
export function closeBlocker(
  fn: 'release' | 'cancel', pact: PactRecord, isHost: boolean, wallet: string, nowSeconds: number,
): string | null {
  if (pact.state !== 'open') return 'This pact is not open'
  const openedByMe = pact.host.toLowerCase() === wallet.toLowerCase()
  if (fn === 'release') {
    if (!isHost) return 'Only the host can do this'
    if (!openedByMe) return 'This pact was opened from another wallet'
    if (pact.sharesPaid < pact.sharesNeeded) {
      return `Waiting for ${pact.sharesNeeded - pact.sharesPaid} more of ${pact.sharesNeeded} shares`
    }
    return null
  }
  if ((isHost && openedByMe) || nowSeconds > pact.deadline) return null
  return isHost ? 'This pact was opened from another wallet' : 'Only the host can cancel before the deadline'
}

export type TxStatus = 'awaiting_pin' | 'pending' | 'confirmed' | 'failed'

// Where a PIN challenge stands. "complete" means the PIN was entered and Circle made a transaction.
export function challengeOutcome(status: unknown): 'awaiting_pin' | 'failed' | 'complete' {
  if (status === 'COMPLETE') return 'complete'
  if (status === 'FAILED' || status === 'EXPIRED') return 'failed'
  return 'awaiting_pin'
}

// Where a Circle transaction stands. Circle's word alone is not enough for success: the on-chain receipt must
// say 0x1, so a reverted call is failed, and one Circle calls done before the receipt is visible stays pending.
export function txOutcome(state: unknown, receiptStatus: unknown): Exclude<TxStatus, 'awaiting_pin'> {
  if (state === 'FAILED' || state === 'CANCELLED' || state === 'DENIED') return 'failed'
  if (state !== 'CONFIRMED' && state !== 'COMPLETE') return 'pending'
  if (receiptStatus === '0x1') return 'confirmed'
  if (receiptStatus === '0x0') return 'failed'
  return 'pending'
}
