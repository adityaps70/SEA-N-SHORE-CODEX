// Round 14 (2.9): the realtime connection Lambda accepts a typing signal only with a token the app
// signed for this actor, conversation and other participant.
import assert from 'node:assert/strict'
import { createHmac, hkdfSync } from 'node:crypto'
import { register } from 'node:module'
import test from 'node:test'

// The Lambda runtime provides the API Gateway management client; it is not a repository dependency.
const stub = 'data:text/javascript,' + encodeURIComponent('export class ApiGatewayManagementApiClient {} export class PostToConnectionCommand {}')
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(specifier, context, next) {
  if (specifier === '@aws-sdk/client-apigatewaymanagementapi') return { url: ${JSON.stringify(stub)}, shortCircuit: true }
  return next(specifier, context)
}`))

process.env.REALTIME_CONNECTIONS_TABLE = 'test-table'
const { isTypingTokenValid, TYPING_TOKEN_KEY_INFO, TYPING_TOKEN_TTL_SECONDS } = await import('../../infra/aws/app/lambda/realtime-connection.mjs')

const key = Buffer.from(hkdfSync('sha256', 'q'.repeat(48), Buffer.alloc(0), TYPING_TOKEN_KEY_INFO, 32))
const input = {
  actorId: '11111111-1111-4111-8111-111111111111',
  conversationId: '33333333-3333-4333-8333-333333333333',
  targetProfileId: '22222222-2222-4222-8222-222222222222',
}
const now = Date.UTC(2026, 9, 4, 12, 0, 0)

function token({ actorId, conversationId, targetProfileId }, expiresAt) {
  const signature = createHmac('sha256', key).update(`typing\n${actorId}\n${conversationId}\n${targetProfileId}\n${expiresAt}`).digest('base64url')
  return `${expiresAt}.${signature}`
}

test('accepts the token for this actor, conversation and participant only', () => {
  const expiresAt = Math.floor(now / 1000) + 3600
  const valid = token(input, expiresAt)
  assert.equal(isTypingTokenValid(key, valid, input, now), true)
  assert.equal(isTypingTokenValid(key, valid, { ...input, actorId: '44444444-4444-4444-8444-444444444444' }, now), false)
  assert.equal(isTypingTokenValid(key, valid, { ...input, conversationId: '55555555-5555-4555-8555-555555555555' }, now), false)
  assert.equal(isTypingTokenValid(key, valid, { ...input, targetProfileId: '66666666-6666-4666-8666-666666666666' }, now), false)
})

test('refuses missing, malformed, expired and over-long tokens', () => {
  assert.equal(isTypingTokenValid(key, undefined, input, now), false)
  assert.equal(isTypingTokenValid(key, 'garbage', input, now), false)
  assert.equal(isTypingTokenValid(key, token(input, Math.floor(now / 1000) - 1), input, now), false)
  assert.equal(isTypingTokenValid(key, token(input, Math.floor(now / 1000) + TYPING_TOKEN_TTL_SECONDS + 60), input, now), false)
})
