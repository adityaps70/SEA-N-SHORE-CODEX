import { describe, expect, it } from 'vitest'

const PROFILE_ID = '11111111-1111-4111-8111-111111111111'
const SECRET = '0123456789abcdef0123456789abcdef'
const AUDIENCE = 'sea-n-shore-realtime'

type RealtimeTicketCodec = {
  issue: (input: { profileId: string; now: Date }) => {
    ticket: string
    expiresAt: string
  }
  verify: (ticket: string, input: { now: Date }) => {
    profileId: string
    audience: string
    expiresAt: string
    jti: string
  }
}

describe('realtime connection ticket codec', () => {
  it('issues a signed ticket scoped to one profile and the realtime audience for 60 seconds', async () => {
    const modulePath = './ticket'
    const realtime = await import(modulePath) as {
      createRealtimeTicketCodec?: (input: {
        secret: string
        audience: string
        ttlSeconds: number
      }) => RealtimeTicketCodec
    }

    expect(realtime.createRealtimeTicketCodec).toBeTypeOf('function')

    const codec = realtime.createRealtimeTicketCodec!({
      secret: SECRET,
      audience: AUDIENCE,
      ttlSeconds: 60,
    })
    const now = new Date('2026-09-13T09:20:00.000Z')

    const issued = codec.issue({ profileId: PROFILE_ID, now })
    expect(issued.ticket).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(issued.expiresAt).toBe('2026-09-13T09:21:00.000Z')

    expect(codec.verify(issued.ticket, { now: new Date('2026-09-13T09:20:30.000Z') })).toEqual({
      profileId: PROFILE_ID,
      audience: AUDIENCE,
      expiresAt: '2026-09-13T09:21:00.000Z',
      jti: expect.any(String),
    })
  })
})
