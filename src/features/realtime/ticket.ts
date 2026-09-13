import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

type RealtimeTicketPayload = {
  profileId: string
  audience: string
  expiresAt: string
  jti: string
}

type IssueRealtimeTicketInput = {
  profileId: string
  now: Date
}

type VerifyRealtimeTicketInput = {
  now: Date
}

function invalidTicket(): never {
  throw new Error('Invalid realtime ticket')
}

function assertValidDate(value: Date) {
  if (Number.isNaN(value.getTime())) {
    throw new Error('Realtime ticket time must be valid')
  }
}

function signPayload(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function parsePayload(encodedPayload: string): RealtimeTicketPayload {
  try {
    const decoded = Buffer.from(encodedPayload, 'base64url').toString('utf8')
    const parsed = JSON.parse(decoded) as Partial<RealtimeTicketPayload>

    if (
      typeof parsed.profileId !== 'string' ||
      parsed.profileId.length === 0 ||
      typeof parsed.audience !== 'string' ||
      parsed.audience.length === 0 ||
      typeof parsed.expiresAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.expiresAt)) ||
      typeof parsed.jti !== 'string' ||
      parsed.jti.length === 0
    ) {
      return invalidTicket()
    }

    return {
      profileId: parsed.profileId,
      audience: parsed.audience,
      expiresAt: parsed.expiresAt,
      jti: parsed.jti,
    }
  } catch {
    return invalidTicket()
  }
}

export function createRealtimeTicketCodec(input: {
  secret: string
  audience: string
  ttlSeconds: number
}) {
  if (input.secret.length < 32) {
    throw new Error('Realtime ticket secret must be at least 32 characters')
  }
  if (input.audience.length === 0) {
    throw new Error('Realtime ticket audience is required')
  }
  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds <= 0) {
    throw new Error('Realtime ticket TTL must be a positive integer')
  }

  return {
    issue({ profileId, now }: IssueRealtimeTicketInput) {
      assertValidDate(now)
      if (profileId.length === 0) {
        throw new Error('Realtime ticket profile is required')
      }

      const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000).toISOString()
      const payload: RealtimeTicketPayload = {
        profileId,
        audience: input.audience,
        expiresAt,
        jti: randomUUID(),
      }
      const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
      const signature = signPayload(encodedPayload, input.secret)

      return {
        ticket: `${encodedPayload}.${signature}`,
        expiresAt,
      }
    },

    verify(ticket: string, { now }: VerifyRealtimeTicketInput) {
      assertValidDate(now)

      const parts = ticket.split('.')
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return invalidTicket()
      }

      const [encodedPayload, suppliedSignature] = parts
      const expectedSignature = signPayload(encodedPayload, input.secret)
      const suppliedBuffer = Buffer.from(suppliedSignature, 'utf8')
      const expectedBuffer = Buffer.from(expectedSignature, 'utf8')

      if (
        suppliedBuffer.length !== expectedBuffer.length ||
        !timingSafeEqual(suppliedBuffer, expectedBuffer)
      ) {
        return invalidTicket()
      }

      const payload = parsePayload(encodedPayload)
      if (payload.audience !== input.audience) {
        return invalidTicket()
      }

      if (Date.parse(payload.expiresAt) <= now.getTime()) {
        return invalidTicket()
      }

      return payload
    },
  }
}
