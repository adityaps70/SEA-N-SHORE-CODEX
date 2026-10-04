import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NetworkRepository } from './repository'
import type { OutboxRepository } from '@/features/events/outbox-repository'
import type { SocialActionQuotas } from '@/features/social/quotas'
import { sendConnectionRequestWithAurora } from './service'
import { sendConnectionRequest } from './actions'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const TARGET_ID = '22222222-2222-4222-8222-222222222222'
const CONNECTION_ID = '44444444-4444-4444-8444-444444444444'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/features/auth/aws-queries', () => ({
  requireAwsUser: vi.fn(async () => ({ id: VIEWER_ID, cognitoSub: 'cognito-sub-1', email: 'member@example.com' })),
}))
vi.mock('./service', async (importOriginal) => ({
  ...await importOriginal<typeof import('./service')>(),
  sendConnectionRequestWithAurora: vi.fn(async () => CONNECTION_ID),
}))

function makeRepository(overrides: Record<string, unknown> = {}) {
  return {
    isMemberReady: vi.fn(async () => true),
    isPairBlocked: vi.fn(async () => false),
    createNotification: vi.fn(async () => undefined),
    findConnectionByPair: vi.fn(async () => null),
    insertConnection: vi.fn(async () => CONNECTION_ID),
    ...overrides,
  }
}

async function serviceWith(repo = makeRepository(), quotas?: SocialActionQuotas) {
  const { createNetworkService } = await import('./service')
  const outbox = { enqueue: vi.fn(async () => undefined) }
  const service = createNetworkService({
    withTransaction: async (fn) => fn({
      network: repo as unknown as NetworkRepository,
      outbox: outbox as unknown as OutboxRepository,
      ...(quotas ? { quotas } : {}),
    }),
  })
  return { service, repo, outbox }
}

function quotas(consume: SocialActionQuotas['consume'] = vi.fn(async () => ({ counted: true }))) {
  return { consume: vi.fn(consume) }
}

describe('connection request quotas in the network service', () => {
  it('counts the request against the requester, for the target member, before inserting it', async () => {
    const quota = quotas()
    const { service, repo } = await serviceWith(makeRepository(), quota)

    await expect(service.sendConnectionRequest(VIEWER_ID, TARGET_ID)).resolves.toBe(CONNECTION_ID)

    expect(quota.consume).toHaveBeenCalledWith({ profileId: VIEWER_ID, action: 'connection_request', targetProfileId: TARGET_ID })
    expect(quota.consume.mock.invocationCallOrder[0]).toBeLessThan(repo.insertConnection.mock.invocationCallOrder[0])
  })

  it.each(['network_connection_request_limit', 'network_connection_request_cooldown'])('stops on %s without inserting, notifying or publishing', async (code) => {
    const quota = quotas(async () => { throw new Error(code) })
    const { service, repo, outbox } = await serviceWith(makeRepository(), quota)

    await expect(service.sendConnectionRequest(VIEWER_ID, TARGET_ID)).rejects.toThrow(code)

    expect(repo.insertConnection).not.toHaveBeenCalled()
    expect(repo.createNotification).not.toHaveBeenCalled()
    expect(outbox.enqueue).not.toHaveBeenCalled()
  })

  it('reports an existing pending or accepted connection without using the quota', async () => {
    const quota = quotas()
    const { service } = await serviceWith(makeRepository({
      findConnectionByPair: vi.fn(async () => ({
        id: CONNECTION_ID,
        user_low_id: VIEWER_ID,
        user_high_id: TARGET_ID,
        requested_by: VIEWER_ID,
        status: 'pending',
      })),
    }), quota)

    await expect(service.sendConnectionRequest(VIEWER_ID, TARGET_ID)).rejects.toThrow('network_request_exists')
    expect(quota.consume).not.toHaveBeenCalled()
  })

  it('does not use the quota for follows, accepts, declines or withdrawals', async () => {
    const quota = quotas()
    const { service } = await serviceWith(makeRepository({
      insertFollow: vi.fn(async () => false),
      findConnectionByIdForUpdate: vi.fn(async () => null),
    }), quota)

    await service.follow(VIEWER_ID, TARGET_ID)
    await expect(service.cancelConnectionRequest(VIEWER_ID, CONNECTION_ID)).rejects.toThrow('network_action_not_allowed')
    expect(quota.consume).not.toHaveBeenCalled()
  })
})

describe('connection request quota messages', () => {
  const mockedSend = vi.mocked(sendConnectionRequestWithAurora)

  beforeEach(() => {
    mockedSend.mockReset()
  })

  it('explains the daily limit', async () => {
    mockedSend.mockRejectedValueOnce(new Error('network_connection_request_limit'))
    expect(await sendConnectionRequest(TARGET_ID)).toEqual({
      ok: false,
      error: "You've sent a lot of connection requests today. Please try again tomorrow.",
    })
  })

  it('explains the 7-day re-request cooldown', async () => {
    mockedSend.mockRejectedValueOnce(new Error('network_connection_request_cooldown'))
    expect(await sendConnectionRequest(TARGET_ID)).toEqual({
      ok: false,
      error: 'You can send this member a new request 7 days after your last one.',
    })
  })

  it('keeps the existing messages for other errors', async () => {
    mockedSend.mockRejectedValueOnce(new Error('network_request_exists'))
    expect(await sendConnectionRequest(TARGET_ID)).toEqual({ ok: false, error: 'Request already sent.' })
    mockedSend.mockRejectedValueOnce(new Error('connection reset'))
    expect(await sendConnectionRequest(TARGET_ID)).toEqual({ ok: false, error: 'We could not update this relationship. Please try again.' })
  })
})
