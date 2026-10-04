import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'

/**
 * Round 14 (2.9): the realtime WebSocket Lambda has no database access, so it cannot check that the
 * sender of a typing signal belongs to the conversation. The app checks membership and signs a
 * short-lived token for (actor, conversation, other participant); the Lambda verifies it against
 * the actor on the connection before relaying the signal.
 *
 * Token: <expiresAt>.<signature>. The key is derived (HKDF, own label) from the realtime ticket
 * secret. infra/aws/app/lambda/realtime-connection.mjs derives the same key and checks the same
 * message, so the two must stay in step.
 */
export const TYPING_TOKEN_TTL_SECONDS = 12 * 60 * 60
export const TYPING_TOKEN_KEY_INFO = 'sea-n-shore/realtime-typing/v1'
const TOKEN_PATTERN = /^(\d{10})\.([A-Za-z0-9_-]{43})$/

type Environment = Record<string, string | undefined>

let cachedKey: { source: string; key: Buffer } | null = null

export function typingTokenKey(environment: Environment = process.env): Buffer | null {
  const source = environment.REALTIME_TICKET_SECRET?.trim() || ''
  if (source.length < 32) return null
  if (cachedKey?.source === source) return cachedKey.key
  const key = Buffer.from(hkdfSync('sha256', source, Buffer.alloc(0), TYPING_TOKEN_KEY_INFO, 32))
  cachedKey = { source, key }
  return key
}

export function typingTokenMessage(actorId: string, conversationId: string, targetProfileId: string, expiresAt: number) {
  return `typing\n${actorId}\n${conversationId}\n${targetProfileId}\n${expiresAt}`
}

function sign(key: Buffer, message: string) {
  return createHmac('sha256', key).update(message).digest('base64url')
}

export function createTypingToken(
  input: { actorId: string; conversationId: string; targetProfileId: string },
  options: { now?: number; environment?: Environment } = {},
): { token: string; expiresAt: number } | null {
  const key = typingTokenKey(options.environment)
  if (!key) return null
  const expiresAt = Math.floor((options.now ?? Date.now()) / 1000) + TYPING_TOKEN_TTL_SECONDS
  const signature = sign(key, typingTokenMessage(input.actorId, input.conversationId, input.targetProfileId, expiresAt))
  return { token: `${expiresAt}.${signature}`, expiresAt }
}

export function verifyTypingToken(
  token: string,
  input: { actorId: string; conversationId: string; targetProfileId: string },
  options: { now?: number; environment?: Environment } = {},
): boolean {
  const key = typingTokenKey(options.environment)
  const match = key ? TOKEN_PATTERN.exec(token) : null
  if (!key || !match) return false
  const expiresAt = Number(match[1])
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000)
  if (expiresAt <= nowSeconds || expiresAt > nowSeconds + TYPING_TOKEN_TTL_SECONDS) return false
  const expected = Buffer.from(sign(key, typingTokenMessage(input.actorId, input.conversationId, input.targetProfileId, expiresAt)))
  const given = Buffer.from(match[2])
  return given.length === expected.length && timingSafeEqual(given, expected)
}
