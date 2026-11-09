import {
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb'
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi'
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { createHmac, hkdfSync, randomUUID, timingSafeEqual } from 'node:crypto'

const dynamodb = new DynamoDBClient({})
const secrets = new SecretsManagerClient({})
const tableName = process.env.REALTIME_CONNECTIONS_TABLE
const profileIndexName = process.env.REALTIME_PROFILE_INDEX ?? 'profile_id-index'
const ticketSecretArn = process.env.REALTIME_TICKET_SECRET_ARN

// Round 14 (2.9): membership is checked by the app, which signs a typing token for
// (actor, conversation, other participant); see src/features/realtime/typing-token.ts.
export const TYPING_TOKEN_KEY_INFO = 'sea-n-shore/realtime-typing/v1'
export const TYPING_TOKEN_TTL_SECONDS = 12 * 60 * 60
// At most one typing signal per connection per 2 s.
export const TYPING_MIN_INTERVAL_MS = 2_000
const TYPING_TOKEN_PATTERN = /^(\d{10})\.([A-Za-z0-9_-]{43})$/
// Round ARCH (Phase 5): at most this many live connections per member; a further one is refused at $connect (that
// tab keeps working on its 60-second checks). Expired rows found on the way are removed and not counted.
export const MAX_CONNECTIONS_PER_MEMBER = 5
let cachedTypingKey
function managementClient(event) {
  const domainName = event.requestContext?.domainName
  const stage = event.requestContext?.stage
  if (!domainName || !stage) return null
  return new ApiGatewayManagementApiClient({
    endpoint: `https://${domainName}/${stage}`,
  })
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function response(statusCode, body) {
  return {
    statusCode,
    body: JSON.stringify(body),
  }
}

async function deleteConnection(connectionId) {
  await dynamodb.send(new DeleteItemCommand({
    TableName: tableName,
    Key: {
      connection_id: { S: connectionId },
    },
  }))
}

async function currentProfileId(connectionId) {
  const result = await dynamodb.send(new GetItemCommand({
    TableName: tableName,
    Key: {
      connection_id: { S: connectionId },
    },
    ProjectionExpression: 'profile_id, expires_at',
  }))
  const profileId = result.Item?.profile_id?.S
  const expiresAt = Number(result.Item?.expires_at?.N)
  if (!profileId || !Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
    if (result.Item) await deleteConnection(connectionId)
    return null
  }
  return profileId
}

async function targetConnections(profileId) {
  const result = await dynamodb.send(new QueryCommand({
    TableName: tableName,
    IndexName: profileIndexName,
    KeyConditionExpression: '#profileId = :profileId',
    ExpressionAttributeNames: {
      '#profileId': 'profile_id',
      '#connectionId': 'connection_id',
      '#expiresAt': 'expires_at',
    },
    ExpressionAttributeValues: {
      ':profileId': { S: profileId },
    },
    ProjectionExpression: '#connectionId, #expiresAt',
  }))
  return result.Items ?? []
}

async function pushTyping(websocket, connectionId, data) {
  try {
    await websocket.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: data,
    }))
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode
    if (status === 410 || error?.name === 'GoneException') {
      await deleteConnection(connectionId)
      return
    }
    throw error
  }
}

async function typingTokenKey() {
  if (cachedTypingKey) return cachedTypingKey
  if (!ticketSecretArn) throw new Error('REALTIME_TICKET_SECRET_ARN is not configured')
  const result = await secrets.send(new GetSecretValueCommand({ SecretId: ticketSecretArn }))
  const source = result.SecretString?.trim() ?? ''
  if (source.length < 32) throw new Error('Realtime ticket secret is unavailable')
  cachedTypingKey = Buffer.from(hkdfSync('sha256', source, Buffer.alloc(0), TYPING_TOKEN_KEY_INFO, 32))
  return cachedTypingKey
}

export function isTypingTokenValid(key, token, { actorId, conversationId, targetProfileId }, nowMs = Date.now()) {
  const match = typeof token === 'string' ? TYPING_TOKEN_PATTERN.exec(token) : null
  if (!match) return false
  const expiresAt = Number(match[1])
  const nowSeconds = Math.floor(nowMs / 1000)
  if (expiresAt <= nowSeconds || expiresAt > nowSeconds + TYPING_TOKEN_TTL_SECONDS) return false
  const message = `typing\n${actorId}\n${conversationId}\n${targetProfileId}\n${expiresAt}`
  const expected = Buffer.from(createHmac('sha256', key).update(message).digest('base64url'))
  const given = Buffer.from(match[2])
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** Claims this connection's typing slot; false when the last signal was under 2 s ago. */
async function claimTypingSlot(connectionId, nowMs = Date.now()) {
  try {
    await dynamodb.send(new UpdateItemCommand({
      TableName: tableName,
      Key: { connection_id: { S: connectionId } },
      UpdateExpression: 'SET last_typing_at = :now',
      ConditionExpression: 'attribute_exists(connection_id) AND (attribute_not_exists(last_typing_at) OR last_typing_at <= :cutoff)',
      ExpressionAttributeValues: {
        ':now': { N: String(nowMs) },
        ':cutoff': { N: String(nowMs - TYPING_MIN_INTERVAL_MS) },
      },
    }))
    return true
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') return false
    throw error
  }
}

/** Live connections of a member, removing expired rows on the way. */
async function liveConnectionCount(profileId, nowSeconds) {
  let live = 0
  for (const item of await targetConnections(profileId)) {
    const connectionId = item.connection_id?.S
    const expiresAt = Number(item.expires_at?.N)
    if (!connectionId) continue
    if (!Number.isFinite(expiresAt) || expiresAt <= nowSeconds) {
      await deleteConnection(connectionId)
      continue
    }
    live += 1
  }
  return live
}

async function handleClientMessage(connectionId, event) {
  let body
  try {
    body = JSON.parse(event.body ?? '{}')
  } catch {
    return response(400, { error: 'invalid_json' })
  }

  // Round ARCH (Phase 5): the browser's 5-minute heartbeat keeps the socket inside API Gateway's 10-minute idle
  // limit. Answered at once: no table, no secret, no push.
  if (body?.action === 'ping') return response(200, { pong: true })

  if (body?.action !== 'typing') {
    return response(400, { error: 'client_messages_not_supported' })
  }
  return handleTyping(connectionId, event, body)
}

async function handleTyping(connectionId, event, body) {
  const websocket = managementClient(event)
  if (!websocket) throw new Error('REALTIME_MANAGEMENT_ENDPOINT is unavailable')

  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : ''
  const targetProfileId = typeof body.targetProfileId === 'string' ? body.targetProfileId : ''
  if (
    !UUID_RE.test(conversationId)
    || !UUID_RE.test(targetProfileId)
    || typeof body.isTyping !== 'boolean'
  ) {
    return response(400, { error: 'invalid_typing_payload' })
  }

  const actorId = await currentProfileId(connectionId)
  if (!actorId) return response(401, { error: 'authentication_required' })
  if (actorId === targetProfileId) return response(400, { error: 'invalid_typing_target' })
  if (!isTypingTokenValid(await typingTokenKey(), body.typingToken, { actorId, conversationId, targetProfileId })) {
    return response(403, { error: 'typing_not_allowed' })
  }
  if (!(await claimTypingSlot(connectionId))) return response(429, { error: 'typing_rate_limited' })

  const signal = {
    eventId: randomUUID(),
    eventType: 'conversation.typing',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    aggregateId: conversationId,
    payload: {
      eventType: 'conversation.typing',
      conversationId,
      actorId,
      targetProfileId,
      isTyping: body.isTyping,
    },
  }
  const data = Buffer.from(JSON.stringify(signal))
  const nowSeconds = Math.floor(Date.now() / 1000)
  const connections = await targetConnections(targetProfileId)

  for (const item of connections) {
    const targetConnectionId = item.connection_id?.S
    const expiresAt = Number(item.expires_at?.N)
    if (!targetConnectionId) continue
    if (!Number.isFinite(expiresAt) || expiresAt <= nowSeconds) {
      await deleteConnection(targetConnectionId)
      continue
    }
    await pushTyping(websocket, targetConnectionId, data)
  }

  return response(200, { accepted: true })
}

export async function handler(event) {
  if (!tableName) throw new Error('REALTIME_CONNECTIONS_TABLE is required')

  const connectionId = event.requestContext?.connectionId
  const routeKey = event.requestContext?.routeKey
  if (!connectionId || !routeKey) return response(400, { error: 'invalid_request' })

  if (routeKey === '$connect') {
    const profileId = event.requestContext?.authorizer?.profileId
    const expiresAt = Number(event.requestContext?.authorizer?.connectionExpiresAt)
    if (!profileId || !Number.isFinite(expiresAt)) {
      return response(401, { error: 'authentication_required' })
    }

    const nowSeconds = Math.floor(Date.now() / 1000)
    if (await liveConnectionCount(String(profileId), nowSeconds) >= MAX_CONNECTIONS_PER_MEMBER) {
      return response(429, { error: 'too_many_connections' })
    }
    await dynamodb.send(new PutItemCommand({
      TableName: tableName,
      Item: {
        connection_id: { S: connectionId },
        profile_id: { S: String(profileId) },
        connected_at: { N: String(nowSeconds) },
        expires_at: { N: String(Math.floor(expiresAt)) },
      },
    }))

    return response(200, { connected: true })
  }

  if (routeKey === '$disconnect') {
    await deleteConnection(connectionId)
    return response(200, { disconnected: true })
  }

  if (routeKey === '$default') {
    return handleClientMessage(connectionId, event)
  }

  return response(400, { error: 'client_messages_not_supported' })
}
