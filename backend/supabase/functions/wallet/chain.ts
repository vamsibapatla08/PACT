// Pure helpers for talking to PactSplit on Arc. No imports, so they test without the Edge runtime.

// Full-precision decimal string of an 18-decimal amount, which is the form Circle takes amounts in.
export function usdcString(wei: bigint) {
  const frac = (wei % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '')
  return frac ? `${wei / 10n ** 18n}.${frac}` : `${wei / 10n ** 18n}`
}

// A pact's uuid as the bytes32 key PactSplit stores it under: the 16 uuid bytes, left-aligned.
export function pactKey(pactId: string) {
  return `0x${pactId.replace(/-/g, '').toLowerCase()}${'0'.repeat(32)}`
}

export const PACTS_SELECTOR = '0xf8bfca8b' // pacts(bytes32)

export type OnChainPact = { host: string; payee: string; share: bigint }

// Decodes the eth_call reply of pacts(key). Returns null unless the pact is open (state 1).
export function decodeOpenPact(result: unknown): OnChainPact | null {
  if (typeof result !== 'string' || result.length < 2 + 64 * 7) return null
  const word = (i: number) => result.slice(2 + 64 * i, 2 + 64 * (i + 1))
  // Words: host, payee, share, sharesNeeded, sharesPaid, deadline, state.
  if (BigInt('0x' + word(6)) !== 1n) return null
  return { host: '0x' + word(0).slice(24), payee: '0x' + word(1).slice(24), share: BigInt('0x' + word(2)) }
}
