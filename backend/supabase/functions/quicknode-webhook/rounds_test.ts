import { assertEquals } from 'jsr:@std/assert@1'
import { pactIdFromTopic } from './logs.ts'
import { pactKey } from '../wallet/chain.ts'

const ID = '123e4567-e89b-12d3-a456-426614174000'

Deno.test('round 0 is the original key, so collections opened before rounds keep their id', () => {
  assertEquals(pactKey(ID), '0x123e4567e89b12d3a456426614174000' + '0'.repeat(32))
  assertEquals(pactKey(ID, 0), pactKey(ID))
})

Deno.test('each reopened round gets its own key, and the webhook maps it back to the pact', () => {
  const round2 = pactKey(ID, 2)
  assertEquals(round2, '0x123e4567e89b12d3a456426614174000' + '0'.repeat(31) + '2')
  assertEquals(pactIdFromTopic(round2), ID)
  assertEquals(pactIdFromTopic(pactKey(ID, 255)), ID)
})

Deno.test('a key whose right half is not a small round number is not ours', () => {
  assertEquals(pactIdFromTopic('0x123e4567e89b12d3a456426614174000' + 'f'.repeat(32)), null)
})
