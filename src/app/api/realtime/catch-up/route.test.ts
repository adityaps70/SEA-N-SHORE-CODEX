import { beforeEach, describe, expect, it, vi } from 'vitest'

const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333'
const MESSAGE_ID = '44444444-4444-4444-8444-444444444444'
const AFTER = {
  createdAt: '2026-09-13T09:00:00.000Z',
  id: MESSAGE_ID,
}

const messaging = vi.hoisted(() => ({
  getConversationMessagesAfter: vi.fn(),
}))

const auth = vi.hoisted(() => {
  class AwsAuthenticationRequiredError extends Error {
    constructor() {
      super('Authentication required.')
      this.name = 'AwsAuthenticationRequiredError'
    }
  }

  return { AwsAuthenticationRequiredError }
})

vi.mock('@/features/messaging/queries', () => ({
  getConversationMessagesAfter: messaging.getConversationMessagesAfter,
}))

vi.mock('@/features/auth/aws-queries', () => ({
  AwsAuthenticationRequiredError: auth.AwsAuthenticationRequiredError,
}))

function request(body: unknown) {
  return new Request('https://seaandshore.example/api/realtime/catch-up', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/realtime/catch-up', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    messaging.getConversationMessagesAfter.mockResolvedValue({
      messages: [],
      nextCursor: null,
    })
  })

  it('returns canonical newer messages with no-store caching', async () => {
    const routePath = './route'
    const { POST } = await import(routePath) as { POST: (request: Request) => Promise<Response> }
    const input = {
      conversationId: CONVERSATION_ID,
      after: AFTER,
      limit: 100,
    }

    const response = await POST(request(input))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ messages: [], nextCursor: null })
    expect(messaging.getConversationMessagesAfter).toHaveBeenCalledWith(input)
  })

  it('maps invalid catch-up input to 400', async () => {
    messaging.getConversationMessagesAfter.mockRejectedValue(new Error('messaging_invalid_catchup_request'))

    const routePath = './route'
    const { POST } = await import(routePath) as { POST: (request: Request) => Promise<Response> }
    const response = await POST(request({ conversationId: 'invalid' }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'messaging_invalid_catchup_request' })
  })

  it('maps nonparticipants to 403', async () => {
    messaging.getConversationMessagesAfter.mockRejectedValue(new Error('messaging_not_participant'))

    const routePath = './route'
    const { POST } = await import(routePath) as { POST: (request: Request) => Promise<Response> }
    const response = await POST(request({
      conversationId: CONVERSATION_ID,
      after: AFTER,
      limit: 50,
    }))

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'messaging_not_participant' })
  })

  it('maps missing AWS authentication to 401', async () => {
    messaging.getConversationMessagesAfter.mockRejectedValue(new auth.AwsAuthenticationRequiredError())

    const routePath = './route'
    const { POST } = await import(routePath) as { POST: (request: Request) => Promise<Response> }
    const response = await POST(request({
      conversationId: CONVERSATION_ID,
      after: AFTER,
      limit: 50,
    }))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Authentication required.' })
  })
})
