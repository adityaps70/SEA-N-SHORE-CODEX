import {
  DeleteItemCommand,
  DynamoDBClient,
  QueryCommand,
} from '@aws-sdk/client-dynamodb'
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi'

const dynamodb = new DynamoDBClient({})
const tableName = process.env.REALTIME_CONNECTIONS_TABLE
const profileIndexName = process.env.REALTIME_PROFILE_INDEX ?? 'profile_id-index'
const managementEndpoint = process.env.REALTIME_MANAGEMENT_ENDPOINT
const websocket = managementEndpoint
  ? new ApiGatewayManagementApiClient({ endpoint: managementEndpoint })
  : null

function getAudience(event) {
  if (event?.eventType === 'message.created') {
    const senderId = event.payload?.senderId
    const recipients = Array.isArray(event.payload?.recipientProfileIds)
      ? event.payload.recipientProfileIds
      : []
    return [...new Set([senderId, ...recipients].filter(Boolean))]
  }

  if (event?.eventType === 'conversation.read_cursor_advanced') {
    const participants = Array.isArray(event.payload?.participantProfileIds)
      ? event.payload.participantProfileIds
      : []
    return [...new Set(participants.filter(Boolean))]
  }

  return []
}

function toRealtimeSignal(event) {
  return {
    eventId: event.id,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    aggregateId: event.aggregateId,
    payload: event.payload,
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

async function listConnections(profileId) {
  const response = await dynamodb.send(new QueryCommand({
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

  return response.Items ?? []
}

async function pushSignal(connectionId, data) {
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

async function fanout(event) {
  if (!tableName) throw new Error('REALTIME_CONNECTIONS_TABLE is required')
  if (!websocket) throw new Error('REALTIME_MANAGEMENT_ENDPOINT is required')

  const audience = getAudience(event)
  if (audience.length === 0) return

  const data = Buffer.from(JSON.stringify(toRealtimeSignal(event)))
  const nowSeconds = Math.floor(Date.now() / 1000)

  for (const profileId of audience) {
    const connections = await listConnections(profileId)
    for (const item of connections) {
      const connectionId = item.connection_id?.S
      const expiresAt = Number(item.expires_at?.N)
      if (!connectionId) continue

      if (!Number.isFinite(expiresAt) || expiresAt <= nowSeconds) {
        await deleteConnection(connectionId)
        continue
      }

      await pushSignal(connectionId, data)
    }
  }
}

export async function handler(event) {
  const batchItemFailures = []

  for (const record of event.Records ?? []) {
    try {
      const envelope = JSON.parse(record.body)
      const domainEvent = envelope.detail
      if (!domainEvent?.id || !domainEvent?.eventType) continue
      await fanout(domainEvent)
    } catch (error) {
      console.error('[realtime_fanout_error]', error instanceof Error ? error.message : 'unknown_error')
      if (record.messageId) batchItemFailures.push({ itemIdentifier: record.messageId })
    }
  }

  return { batchItemFailures }
}
