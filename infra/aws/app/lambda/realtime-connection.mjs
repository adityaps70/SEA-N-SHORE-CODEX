import {
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb'
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi'
import { randomUUID } from 'node:crypto'

const dynamodb = new DynamoDBClient({})
const tableName = process.env.REALTIME_CONNECTIONS_TABLE
const profileIndexName = process.env.REALTIME_PROFILE_INDEX ?? 'profile_id-index'
const managementEndpoint = process.env.REALTIME_MANAGEMENT_ENDPOINT
const websocket = managementEndpoint
  ? new ApiGatewayManagementApiClient({ endpoint: managementEndpoint })
  : null

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

async function pushTyping(connectionId, data) {
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

async function handleTyping(connectionId, event) {
  if (!websocket) throw new Error('REALTIME_MANAGEMENT_ENDPOINT is required')

  let body
  try {
    body = JSON.parse(event.body ?? '{}')
  } catch {
    return response(400, { error: 'invalid_json' })
  }

  if (body?.action !== 'typing') {
    return response(400, { error: 'client_messages_not_supported' })
  }

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
    await pushTyping(targetConnectionId, data)
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
    return handleTyping(connectionId, event)
  }

  return response(400, { error: 'client_messages_not_supported' })
}
