import { describe, expect, it } from 'vitest'
import { createTypingToken, TYPING_TOKEN_TTL_SECONDS, verifyTypingToken } from './typing-token'

const environment = { REALTIME_TICKET_SECRET: 'x'.repeat(48) }
const input = {
  actorId: '11111111-1111-4111-8111-111111111111',
  conversationId: '33333333-3333-4333-8333-333333333333',
  targetProfileId: '22222222-2222-4222-8222-222222222222',
}
const now = Date.UTC(2026, 9, 4, 12, 0, 0)

describe('typing tokens (Round 14, 2.9)', () => {
  it('verifies only for the same actor, conversation and other participant', () => {
    const issued = createTypingToken(input, { now, environment })
    expect(issued).not.toBeNull()
    expect(issued!.expiresAt).toBe(Math.floor(now / 1000) + TYPING_TOKEN_TTL_SECONDS)
    expect(verifyTypingToken(issued!.token, input, { now, environment })).toBe(true)
    expect(verifyTypingToken(issued!.token, { ...input, actorId: '44444444-4444-4444-8444-444444444444' }, { now, environment })).toBe(false)
    expect(verifyTypingToken(issued!.token, { ...input, conversationId: '55555555-5555-4555-8555-555555555555' }, { now, environment })).toBe(false)
    expect(verifyTypingToken(issued!.token, { ...input, targetProfileId: '66666666-6666-4666-8666-666666666666' }, { now, environment })).toBe(false)
  })

  it('refuses expired, malformed or differently keyed tokens, and signs nothing without the secret', () => {
    const issued = createTypingToken(input, { now, environment })!
    expect(verifyTypingToken(issued.token, input, { now: now + (TYPING_TOKEN_TTL_SECONDS + 1) * 1000, environment })).toBe(false)
    expect(verifyTypingToken('not-a-token', input, { now, environment })).toBe(false)
    expect(verifyTypingToken(issued.token, input, { now, environment: { REALTIME_TICKET_SECRET: 'y'.repeat(48) } })).toBe(false)
    expect(createTypingToken(input, { now, environment: {} })).toBeNull()
  })
})
