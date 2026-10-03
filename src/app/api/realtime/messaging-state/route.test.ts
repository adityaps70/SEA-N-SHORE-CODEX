import { beforeEach, describe, expect, it, vi } from 'vitest'

const messaging = vi.hoisted(() => ({
  getConversationInbox: vi.fn(),
  getUnreadMessageCount: vi.fn(),
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
  getConversationInbox: messaging.getConversationInbox,
  getUnreadMessageCount: messaging.getUnreadMessageCount,
}))

vi.mock('@/features/auth/aws-queries', () => ({
  AwsAuthenticationRequiredError: auth.AwsAuthenticationRequiredError,
}))

describe('GET /api/realtime/messaging-state', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    messaging.getConversationInbox.mockResolvedValue([{ conversationId: 'conversation-1' }])
    messaging.getUnreadMessageCount.mockResolvedValue(3)
  })

  it('returns canonical inbox and unread state without caching', async () => {
    const routePath = './route'
    const { GET } = await import(routePath) as { GET: () => Promise<Response> }

    const response = await GET()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({
      inbox: [{ conversationId: 'conversation-1' }],
      unreadCount: 3,
    })
    expect(messaging.getConversationInbox).toHaveBeenCalledWith({ limit: 100 })
    expect(messaging.getUnreadMessageCount).toHaveBeenCalledTimes(1)
  })

  it('maps missing AWS authentication to 401', async () => {
    messaging.getConversationInbox.mockRejectedValue(new auth.AwsAuthenticationRequiredError())

    const routePath = './route'
    const { GET } = await import(routePath) as { GET: () => Promise<Response> }

    const response = await GET()

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Authentication required.' })
  })
})
