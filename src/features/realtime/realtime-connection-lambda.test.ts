import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Round ARCH (Phase 5): the realtime connection Lambda answers the browser's heartbeat with no database work, and
 * refuses a sixth live connection per member at $connect (expired rows are removed and not counted).
 */
type Item = { connection_id: { S: string }; expires_at: { N: string } }
const state = vi.hoisted(() => ({
  connectionsByProfile: new Map<string, Array<{ connection_id: { S: string }; expires_at: { N: string } }>>(),
  commands: [] as Array<{ name: string; input: Record<string, unknown> }>,
}))

vi.mock('@aws-sdk/client-dynamodb', () => {
  class Command { constructor(public input: Record<string, unknown>) {} }
  class QueryCommand extends Command {}
  class DeleteItemCommand extends Command {}
  class PutItemCommand extends Command {}
  class GetItemCommand extends Command {}
  class UpdateItemCommand extends Command {}
  class DynamoDBClient {
    async send(command: Command) {
      state.commands.push({ name: command.constructor.name, input: command.input })
      if (command instanceof QueryCommand) {
        const values = command.input.ExpressionAttributeValues as Record<string, { S: string }>
        return { Items: state.connectionsByProfile.get(values[':profileId'].S) ?? [] }
      }
      return {}
    }
  }
  return { DynamoDBClient, QueryCommand, DeleteItemCommand, PutItemCommand, GetItemCommand, UpdateItemCommand }
})
vi.mock('@aws-sdk/client-apigatewaymanagementapi', () => ({
  ApiGatewayManagementApiClient: class { async send() { return {} } },
  PostToConnectionCommand: class { constructor(public input: unknown) {} },
}))
vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class { async send() { throw new Error('not used') } },
  GetSecretValueCommand: class { constructor(public input: unknown) {} },
}))

process.env.REALTIME_CONNECTIONS_TABLE = 'connections'
const { handler, MAX_CONNECTIONS_PER_MEMBER } = await import('../../../infra/aws/app/lambda/realtime-connection.mjs')

const PROFILE = '11111111-1111-4111-8111-111111111111'
const later = () => String(Math.floor(Date.now() / 1000) + 3600)
const earlier = () => String(Math.floor(Date.now() / 1000) - 10)
const item = (id: string, expiresAt: string): Item => ({ connection_id: { S: id }, expires_at: { N: expiresAt } })
const connect = (connectionId = 'new-connection') => handler({
  requestContext: { connectionId, routeKey: '$connect', authorizer: { profileId: PROFILE, connectionExpiresAt: later() } },
})
const message = (body: string) => handler({ requestContext: { connectionId: 'c1', routeKey: '$default', domainName: 'x', stage: 'live' }, body })

beforeEach(() => {
  state.connectionsByProfile = new Map()
  state.commands = []
})

describe('realtime connection Lambda (Round ARCH Phase 5)', () => {
  it('answers the heartbeat ping with no database work', async () => {
    expect(await message('{"action":"ping"}')).toEqual({ statusCode: 200, body: '{"pong":true}' })
    expect(state.commands).toEqual([])
  })

  it('still refuses other client messages', async () => {
    expect((await message('{"action":"shout"}')).statusCode).toBe(400)
    expect((await message('not json')).statusCode).toBe(400)
  })

  it(`accepts up to ${MAX_CONNECTIONS_PER_MEMBER} live connections per member and refuses the next`, async () => {
    expect(MAX_CONNECTIONS_PER_MEMBER).toBe(5)
    state.connectionsByProfile.set(PROFILE, Array.from({ length: 4 }, (_, index) => item(`live-${index}`, later())))
    expect((await connect()).statusCode).toBe(200)
    expect(state.commands.filter((command) => command.name === 'PutItemCommand')).toHaveLength(1)

    state.commands = []
    state.connectionsByProfile.set(PROFILE, Array.from({ length: 5 }, (_, index) => item(`live-${index}`, later())))
    expect(await connect()).toEqual({ statusCode: 429, body: '{"error":"too_many_connections"}' })
    expect(state.commands.filter((command) => command.name === 'PutItemCommand')).toHaveLength(0)
  })

  it('does not count expired rows, and removes them', async () => {
    state.connectionsByProfile.set(PROFILE, [
      ...Array.from({ length: 4 }, (_, index) => item(`live-${index}`, later())),
      item('stale-1', earlier()),
      item('stale-2', earlier()),
    ])
    expect((await connect()).statusCode).toBe(200)
    const deleted = state.commands.filter((command) => command.name === 'DeleteItemCommand').map((command) => (command.input.Key as { connection_id: { S: string } }).connection_id.S)
    expect(deleted.sort()).toEqual(['stale-1', 'stale-2'])
  })
})
