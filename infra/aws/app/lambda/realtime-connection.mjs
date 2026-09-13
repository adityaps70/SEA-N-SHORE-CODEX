import {
  DeleteItemCommand,
  DynamoDBClient,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb'

const dynamodb = new DynamoDBClient({})
const tableName = process.env.REALTIME_CONNECTIONS_TABLE

function response(statusCode, body) {
  return {
    statusCode,
    body: JSON.stringify(body),
  }
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
    await dynamodb.send(new DeleteItemCommand({
      TableName: tableName,
      Key: {
        connection_id: { S: connectionId },
      },
    }))
    return response(200, { disconnected: true })
  }

  return response(400, { error: 'client_messages_not_supported' })
}
