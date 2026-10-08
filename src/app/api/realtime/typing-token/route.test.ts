import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  findOtherParticipantId: vi.fn(),
}))

vi.mock('@/features/auth/aws-queries', () => {
  class AwsAuthenticationRequiredError extends Error {}
  return { AwsAuthenticationRequiredError, requireAwsUser: mocks.requireAwsUser }
})
vi.mock('@/features/messaging/repository', () => ({
  messagingRepository: { findOtherParticipantId: mocks.findOtherParticipantId },
}))

import { verifyTypingToken } from '@/features/realtime/typing-token'
import { POST } from './route'

const viewerId = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const conversationId = '33333333-3333-4333-8333-333333333333'

function request(body: unknown) {
  return new Request('https://example.test/api/realtime/typing-token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/realtime/typing-token', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('REALTIME_TICKET_SECRET', 'z'.repeat(48))
    mocks.requireAwsUser.mockResolvedValue({ id: viewerId })
  })

  it('signs a token bound to the other participant for a member of the conversation', async () => {
    mocks.findOtherParticipantId.mockResolvedValue(otherId)
    const response = await POST(request({ conversationId }))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    const payload = await response.json() as { token: string; targetProfileId: string }
    expect(mocks.findOtherParticipantId).toHaveBeenCalledWith(conversationId, viewerId)
    expect(payload.targetProfileId).toBe(otherId)
    expect(verifyTypingToken(payload.token, { actorId: viewerId, conversationId, targetProfileId: otherId })).toBe(true)
  })

  it('refuses a conversation the viewer is not part of, and an invalid id', async () => {
    mocks.findOtherParticipantId.mockResolvedValue(null)
    expect((await POST(request({ conversationId }))).status).toBe(404)
    expect((await POST(request({ conversationId: 'nope' }))).status).toBe(400)
    expect(mocks.findOtherParticipantId).toHaveBeenCalledTimes(1)
  })
})
