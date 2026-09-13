import { beforeEach, describe, expect, it, vi } from 'vitest'

const PROFILE_ID = '11111111-1111-4111-8111-111111111111'
const TICKET = 'payload.signature'
const EXPIRES_AT = '2026-09-13T09:31:00.000Z'
const WEBSOCKET_URL = 'wss://example.execute-api.ap-south-1.amazonaws.com/staging'

const auth = vi.hoisted(() => {
  class AwsAuthenticationRequiredError extends Error {
    constructor() {
      super('Authentication required.')
      this.name = 'AwsAuthenticationRequiredError'
    }
  }

  return {
    requireAwsUser: vi.fn(),
    AwsAuthenticationRequiredError,
  }
})

const realtime = vi.hoisted(() => ({
  createRealtimeTicketCodec: vi.fn(),
  issue: vi.fn(),
}))

vi.mock('@/features/auth/aws-queries', () => ({
  requireAwsUser: auth.requireAwsUser,
  AwsAuthenticationRequiredError: auth.AwsAuthenticationRequiredError,
}))

vi.mock('@/features/realtime/ticket', () => ({
  createRealtimeTicketCodec: realtime.createRealtimeTicketCodec,
}))

describe('POST /api/realtime/ticket', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.REALTIME_TICKET_SECRET = '0123456789abcdef0123456789abcdef'
    process.env.REALTIME_WEBSOCKET_URL = WEBSOCKET_URL

    auth.requireAwsUser.mockResolvedValue({
      id: PROFILE_ID,
      cognitoSub: 'cognito-sub',
      email: 'captain@example.com',
    })
    realtime.issue.mockReturnValue({ ticket: TICKET, expiresAt: EXPIRES_AT })
    realtime.createRealtimeTicketCodec.mockReturnValue({ issue: realtime.issue })
  })

  it('issues a no-store realtime ticket only for the authenticated profile', async () => {
    const routePath = './route'
    const { POST } = await import(routePath) as { POST: () => Promise<Response> }

    const response = await POST()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({
      ticket: TICKET,
      expiresAt: EXPIRES_AT,
      webSocketUrl: WEBSOCKET_URL,
    })
    expect(realtime.createRealtimeTicketCodec).toHaveBeenCalledWith({
      secret: process.env.REALTIME_TICKET_SECRET,
      audience: 'sea-n-shore-realtime',
      ttlSeconds: 60,
    })
    expect(realtime.issue).toHaveBeenCalledWith({
      profileId: PROFILE_ID,
      now: expect.any(Date),
    })
  })

  it('returns 401 when there is no authenticated AWS user', async () => {
    auth.requireAwsUser.mockRejectedValue(new auth.AwsAuthenticationRequiredError())

    const routePath = './route'
    const { POST } = await import(routePath) as { POST: () => Promise<Response> }
    const response = await POST()

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Authentication required.' })
    expect(realtime.issue).not.toHaveBeenCalled()
  })
})
