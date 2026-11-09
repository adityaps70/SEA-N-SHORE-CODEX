import { beforeEach, describe, expect, it, vi } from 'vitest'

type Item = { connection_id: { S: string }; expires_at: { N: string } }
const state = vi.hoisted(() => ({
  connectionsByProfile: new Map<string, Array<{ connection_id: { S: string }; expires_at: { N: string } }>>(),
  dynamoCommands: [] as Array<{ name: string; input: Record<string, unknown> }>,
  pushes: [] as Array<{ connectionId: string; data: string }>,
  inFlight: 0,
  maxInFlight: 0,
}))

vi.mock('@aws-sdk/client-dynamodb', () => {
  class Command { constructor(public input: Record<string, unknown>) {} }
  class QueryCommand extends Command {}
  class DeleteItemCommand extends Command {}
  class DynamoDBClient {
    async send(command: Command) {
      state.dynamoCommands.push({ name: command.constructor.name, input: command.input })
      if (command instanceof QueryCommand) {
        const values = command.input.ExpressionAttributeValues as Record<string, { S: string }>
        return { Items: state.connectionsByProfile.get(values[':profileId'].S) ?? [] }
      }
      return {}
    }
  }
  return { DynamoDBClient, QueryCommand, DeleteItemCommand }
})

vi.mock('@aws-sdk/client-apigatewaymanagementapi', () => {
  class PostToConnectionCommand { constructor(public input: { ConnectionId: string; Data: Uint8Array }) {} }
  class ApiGatewayManagementApiClient {
    async send(command: PostToConnectionCommand) {
      state.inFlight += 1
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      state.inFlight -= 1
      state.pushes.push({ connectionId: command.input.ConnectionId, data: Buffer.from(command.input.Data).toString() })
      return {}
    }
  }
  return { ApiGatewayManagementApiClient, PostToConnectionCommand }
})

process.env.REALTIME_CONNECTIONS_TABLE = 'connections'
process.env.REALTIME_MANAGEMENT_ENDPOINT = 'https://example.execute-api.ap-south-1.amazonaws.com/live'

const live = () => String(Math.floor(Date.now() / 1000) + 3600)
const item = (id: string): Item => ({ connection_id: { S: id }, expires_at: { N: live() } })
const record = (detail: unknown) => ({ messageId: 'm1', body: JSON.stringify({ detail }) })
const feedEvent = (eventType: string, audienceProfileIds?: unknown) => ({
  id: 'e1', eventType, schemaVersion: 1, occurredAt: '2026-11-08T05:00:00.000Z', aggregateId: 'post-1',
  payload: { eventType, actorId: 'actor', postId: 'post-1', ...(audienceProfileIds === undefined ? {} : { audienceProfileIds }) },
})

const { handler } = await import('../../../infra/aws/app/lambda/realtime-fanout.mjs')

beforeEach(() => {
  state.connectionsByProfile = new Map()
  state.dynamoCommands = []
  state.pushes = []
  state.inFlight = 0
  state.maxInFlight = 0
})

describe('realtime fan-out (Round ARCH broadcast fix)', () => {
  it('pushes a feed event only to its audience, with no table scan and no content', async () => {
    state.connectionsByProfile.set('follower-1', [item('c-f1a'), item('c-f1b')])
    state.connectionsByProfile.set('follower-2', [item('c-f2')])
    state.connectionsByProfile.set('stranger', [item('c-stranger')])
    const result = await handler({ Records: [record(feedEvent('feed.post_created', ['follower-1', 'follower-2', 'follower-1']))] })
    expect(result.batchItemFailures).toEqual([])
    expect(state.pushes.map((push) => push.connectionId).sort()).toEqual(['c-f1a', 'c-f1b', 'c-f2'])
    expect(state.dynamoCommands.every((command) => command.name !== 'ScanCommand')).toBe(true)
    expect(state.dynamoCommands.filter((command) => command.name === 'QueryCommand')).toHaveLength(2)
    const signal = JSON.parse(state.pushes[0].data)
    expect(signal).toEqual({ eventId: 'e1', eventType: 'feed.post_created', schemaVersion: 1, occurredAt: '2026-11-08T05:00:00.000Z', scope: 'feed' })
  })

  it('sends a feed event without an audience to no one (an old event, or an unreadable audience)', async () => {
    state.connectionsByProfile.set('anyone', [item('c-any')])
    for (const audience of [undefined, [], 'not-a-list', [42, null, '']]) {
      await handler({ Records: [record(feedEvent('feed.post_reaction_changed', audience))] })
    }
    expect(state.pushes).toEqual([])
    expect(state.dynamoCommands).toEqual([])
  })

  it('caps the audience at 500 members and pushes in parallel batches of at most 25', async () => {
    const audience = Array.from({ length: 600 }, (_, index) => `member-${index}`)
    for (const id of audience) state.connectionsByProfile.set(id, [item(`c-${id}`)])
    await handler({ Records: [record(feedEvent('feed.post_reposted', audience))] })
    expect(state.pushes).toHaveLength(500)
    expect(state.maxInFlight).toBeGreaterThan(1)
    expect(state.maxInFlight).toBeLessThanOrEqual(25)
  })

  it('still sends messages to their participants, in parallel', async () => {
    state.connectionsByProfile.set('sender', [item('c-sender')])
    state.connectionsByProfile.set('recipient', [item('c-recipient')])
    await handler({ Records: [record({
      id: 'e2', eventType: 'message.created', schemaVersion: 1, occurredAt: '2026-11-08T05:00:00.000Z', aggregateId: 'conv-1',
      payload: { eventType: 'message.created', senderId: 'sender', recipientProfileIds: ['recipient'], conversationId: 'conv-1', messageId: 'msg-1' },
    })] })
    expect(state.pushes.map((push) => push.connectionId).sort()).toEqual(['c-recipient', 'c-sender'])
  })

  it("pushes a new notification's unread count to its recipient only, with no ids or content (Phase 5)", async () => {
    state.connectionsByProfile.set('recipient', [item('c-recipient-a'), item('c-recipient-b')])
    state.connectionsByProfile.set('someone-else', [item('c-other')])
    await handler({ Records: [record({
      id: 'e3', eventType: 'notification.created', schemaVersion: 1, occurredAt: '2026-11-08T05:00:00.000Z', aggregateId: 'n1',
      payload: { eventType: 'notification.created', recipientId: 'recipient', notificationId: 'n1', audienceProfileIds: ['recipient'], unreadNotificationCount: 4 },
    })] })
    expect(state.pushes.map((push) => push.connectionId).sort()).toEqual(['c-recipient-a', 'c-recipient-b'])
    expect(JSON.parse(state.pushes[0]!.data)).toEqual({
      eventId: 'e3', eventType: 'notification.created', schemaVersion: 1, occurredAt: '2026-11-08T05:00:00.000Z', scope: 'notifications', unreadNotificationCount: 4,
    })
  })

  it('sends a notification event without an audience to no one', async () => {
    state.connectionsByProfile.set('recipient', [item('c-recipient')])
    await handler({ Records: [record({
      id: 'e4', eventType: 'notification.created', schemaVersion: 1, occurredAt: '2026-11-08T05:00:00.000Z', aggregateId: 'n2',
      payload: { eventType: 'notification.created', recipientId: 'recipient', notificationId: 'n2' },
    })] })
    expect(state.pushes).toEqual([])
  })
})
