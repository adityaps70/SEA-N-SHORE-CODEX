import { createHmac, timingSafeEqual } from 'node:crypto'
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'

const secrets = new SecretsManagerClient({})
const audience = process.env.REALTIME_TICKET_AUDIENCE ?? 'sea-n-shore-realtime'
const secretArn = process.env.REALTIME_TICKET_SECRET_ARN
const allowedOrigin = process.env.REALTIME_ALLOWED_ORIGIN?.replace(/\/+$/g, '') ?? ''
let cachedSecret

function deny(event, principalId = 'anonymous') {
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: 'Deny',
          Resource: event.methodArn,
        },
      ],
    },
  }
}

function denyWithReason(event, reason, principalId = 'anonymous') {
  console.warn('[realtime_authorizer_deny]', reason)
  return deny(event, principalId)
}

function allow(event, payload) {
  const nowSeconds = Math.floor(Date.now() / 1000)
  return {
    principalId: payload.profileId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: 'Allow',
          Resource: event.methodArn,
        },
      ],
    },
    context: {
      profileId: payload.profileId,
      ticketId: payload.jti,
      connectionExpiresAt: String(nowSeconds + 3600),
    },
  }
}

async function getSecret() {
  if (cachedSecret) return cachedSecret
  if (!secretArn) throw new Error('REALTIME_TICKET_SECRET_ARN is required')

  const response = await secrets.send(new GetSecretValueCommand({ SecretId: secretArn }))
  const value = response.SecretString
    ?? (response.SecretBinary ? Buffer.from(response.SecretBinary).toString('utf8') : '')
  if (!value) throw new Error('Realtime ticket secret is empty')
  cachedSecret = value
  return cachedSecret
}

function signPayload(encodedPayload, secret) {
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url')
}

function invalidTicket(reason) {
  return { payload: null, reason }
}

function verifyTicket(ticket, secret) {
  const parts = ticket.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return invalidTicket('malformed_ticket')

  const [encodedPayload, suppliedSignature] = parts
  const expectedSignature = signPayload(encodedPayload, secret)
  const suppliedBuffer = Buffer.from(suppliedSignature, 'utf8')
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8')
  if (
    suppliedBuffer.length !== expectedBuffer.length
    || !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) return invalidTicket('signature_mismatch')

  let payload
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
  } catch {
    return invalidTicket('invalid_payload')
  }

  if (
    typeof payload?.profileId !== 'string'
    || typeof payload?.audience !== 'string'
    || typeof payload?.expiresAt !== 'string'
    || typeof payload?.jti !== 'string'
  ) return invalidTicket('invalid_payload')

  if (payload.audience !== audience) return invalidTicket('audience_mismatch')

  const expiresAt = Date.parse(payload.expiresAt)
  if (Number.isNaN(expiresAt)) return invalidTicket('invalid_expiry')
  if (expiresAt <= Date.now()) return invalidTicket('expired_ticket')

  return { payload, reason: null }
}

export async function handler(event) {
  const origin = event.headers?.origin ?? event.headers?.Origin ?? ''
  if (allowedOrigin && origin && origin.replace(/\/+$/g, '') !== allowedOrigin) {
    return denyWithReason(event, 'origin_mismatch')
  }

  const ticket = event.queryStringParameters?.ticket
  if (!ticket) return denyWithReason(event, 'missing_ticket')

  try {
    const secret = await getSecret()
    const verification = verifyTicket(ticket, secret)
    return verification.payload
      ? allow(event, verification.payload)
      : denyWithReason(event, verification.reason)
  } catch (error) {
    console.error('[realtime_authorizer_error]', error instanceof Error ? error.message : 'unknown_error')
    return deny(event)
  }
}
