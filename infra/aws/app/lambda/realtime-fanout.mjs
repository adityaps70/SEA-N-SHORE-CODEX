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

// Round ARCH (broadcast fix): no event goes to every connection any more. Feed events carry their audience
// (payload.audienceProfileIds, added by the outbox publisher: the author's network for a new post, the post's author
// for a like or comment, never a load-test account), at most FEED_AUDIENCE_CAP members.
const FEED_AUDIENCE_CAP = 500
// Lookups and pushes run in parallel batches of this size instead of one after another.
const PARALLEL_BATCH = 25

const FEED_INVALIDATION_EVENT_TYPES = new Set([
  'feed.post_created',
  'feed.post_reaction_changed',
  'feed.post_comments_changed',
  'feed.post_reposted',
])

// Round ARCH (Phase 5): a new notification's recipient (added by the outbox publisher) gets their unread count.
const NOTIFICATION_EVENT_TYPE = 'notification.created'

function getAudience(event) {
  if (FEED_INVALIDATION_EVENT_TYPES.has(event?.eventType) || event?.eventType === NOTIFICATION_EVENT_TYPE) {
    const audience = Array.isArray(event.payload?.audienceProfileIds) ? event.payload.audienceProfileIds : []
    return [...new Set(audience.filter((id) => typeof id === 'string' && id.length > 0))].slice(0, FEED_AUDIENCE_CAP)
  }

  if (event?.eventType === 'message.created') {
    const senderId = event.payload?.senderId
    const recipients = Array.isArray(event.payload?.recipientProfileIds)
      ? event.payload.recipientProfileIds
      : []
    return [...new Set([senderId, ...recipients].filter(Boolean))]
  }

  if (event?.eventType === 'message.updated') {
    const participants = Array.isArray(event.payload?.participantProfileIds)
      ? event.payload.participantProfileIds
      : []
    return [...new Set(participants.filter(Boolean))]
  }

  if (event?.eventType === 'conversation.read_cursor_advanced') {
    const participants = Array.isArray(event.payload?.participantProfileIds)
      ? event.payload.participantProfileIds
      : []
    return [...new Set(participants.filter(Boolean))]
  }

  if (event?.eventType === 'connection.accepted') {
    const actorId = event.payload?.actorId
    const targetId = event.payload?.targetId
    return [...new Set([actorId, targetId].filter(Boolean))]
  }

  return []
}

function toInvalidationSignal(event, scope) {
  return {
    eventId: event.id,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    scope,
  }
}

function toNotificationSignal(event) {
  const count = Number(event.payload?.unreadNotificationCount)
  return {
    eventId: event.id,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    scope: 'notifications',
    ...(Number.isInteger(count) && count >= 0 ? { unreadNotificationCount: count } : {}),
  }
}

function toRealtimeSignal(event) {
  if (event?.eventType === NOTIFICATION_EVENT_TYPE) {
    return toNotificationSignal(event)
  }

  if (FEED_INVALIDATION_EVENT_TYPES.has(event?.eventType)) {
    return toInvalidationSignal(event, 'feed')
  }

  if (event?.eventType === 'connection.accepted') {
    return toInvalidationSignal(event, 'network')
  }

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

async function inParallelBatches(items, work) {
  const results = []
  for (let start = 0; start < items.length; start += PARALLEL_BATCH) {
    results.push(...await Promise.all(items.slice(start, start + PARALLEL_BATCH).map(work)))
  }
  return results
}

async function pushConnectionItems(items, data, nowSeconds) {
  await inParallelBatches(items, async (item) => {
    const connectionId = item.connection_id?.S
    const expiresAt = Number(item.expires_at?.N)
    if (!connectionId) return

    if (!Number.isFinite(expiresAt) || expiresAt <= nowSeconds) {
      await deleteConnection(connectionId)
      return
    }

    await pushSignal(connectionId, data)
  })
}

async function fanout(event) {
  if (!tableName) throw new Error('REALTIME_CONNECTIONS_TABLE is required')
  if (!websocket) throw new Error('REALTIME_MANAGEMENT_ENDPOINT is required')

  const data = Buffer.from(JSON.stringify(toRealtimeSignal(event)))
  const nowSeconds = Math.floor(Date.now() / 1000)

  const audience = getAudience(event)
  if (audience.length === 0) return

  const connections = (await inParallelBatches(audience, listConnections)).flat()
  await pushConnectionItems(connections, data, nowSeconds)
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
