import { describe, expect, it, vi } from 'vitest'
import type { NetworkRepository } from './repository'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const TARGET_ID = '22222222-2222-4222-8222-222222222222'
const THIRD_ID = '33333333-3333-4333-8333-333333333333'
const CONNECTION_ID = '44444444-4444-4444-8444-444444444444'

function connection(overrides: Record<string, unknown> = {}) {
  return {
    id: CONNECTION_ID,
    user_low_id: VIEWER_ID,
    user_high_id: TARGET_ID,
    requested_by: VIEWER_ID,
    status: 'pending' as const,
    created_at: '2026-09-01T10:00:00.000Z',
    updated_at: '2026-09-01T10:00:00.000Z',
    ...overrides,
  }
}

function makeRepository(overrides: Record<string, unknown> = {}) {
  return {
    isMemberReady: vi.fn(async () => true),
    isPairBlocked: vi.fn(async () => false),
    insertFollow: vi.fn(async () => true),
    deleteFollow: vi.fn(async () => true),
    createNotification: vi.fn(async () => undefined),
    findConnectionByPair: vi.fn(async () => null),
    insertConnection: vi.fn(async () => CONNECTION_ID),
    findConnectionByIdForUpdate: vi.fn(async () => null),
    deleteConnectionRequestNotification: vi.fn(async () => undefined),
    deleteConnection: vi.fn(async () => true),
    acceptConnection: vi.fn(async () => true),
    insertMutualFollows: vi.fn(async () => undefined),
    insertBlock: vi.fn(async () => true),
    deleteBlock: vi.fn(async () => true),
    deletePairRelationships: vi.fn(async () => undefined),
    ...overrides,
  }
}

async function service(repo = makeRepository()) {
  const { createNetworkService } = await import('./service')
  const transactionSpy = vi.fn()
  const withTransaction = async <T>(fn: (networkRepository: NetworkRepository) => Promise<T>) => {
    transactionSpy()
    return fn(repo as unknown as NetworkRepository)
  }
  return {
    service: createNetworkService({ withTransaction }),
    repository: repo,
    transactionSpy,
  }
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ message: code })
}

describe('network authorization service', () => {
  it('rejects self interactions before persistence', async () => {
    const context = await service()

    await expectCode(context.service.follow(VIEWER_ID, VIEWER_ID), 'network_self_interaction')
    await expectCode(context.service.sendConnectionRequest(VIEWER_ID, VIEWER_ID), 'network_self_interaction')
    await expectCode(context.service.block(VIEWER_ID, VIEWER_ID), 'network_self_interaction')

    expect(context.transactionSpy).not.toHaveBeenCalled()
  })

  it('rejects follow and connection creation when either member is unavailable or the pair is blocked', async () => {
    const unavailable = await service(makeRepository({ isMemberReady: vi.fn(async (id: string) => id !== TARGET_ID) }))
    await expectCode(unavailable.service.follow(VIEWER_ID, TARGET_ID), 'network_interaction_unavailable')

    const blocked = await service(makeRepository({ isPairBlocked: vi.fn(async () => true) }))
    await expectCode(blocked.service.sendConnectionRequest(VIEWER_ID, TARGET_ID), 'network_interaction_unavailable')
  })

  it('creates a new follower notification only when the follow row is newly inserted', async () => {
    const created = await service()
    await expect(created.service.follow(VIEWER_ID, TARGET_ID)).resolves.toBe(true)
    expect(created.repository.createNotification).toHaveBeenCalledWith({
      recipientId: TARGET_ID,
      actorId: VIEWER_ID,
      type: 'new_follower',
    })

    const existing = await service(makeRepository({ insertFollow: vi.fn(async () => false) }))
    await expect(existing.service.follow(VIEWER_ID, TARGET_ID)).resolves.toBe(false)
    expect(existing.repository.createNotification).not.toHaveBeenCalled()
  })

  it('preserves connection duplicate and already-connected error semantics', async () => {
    const pending = await service(makeRepository({ findConnectionByPair: vi.fn(async () => connection()) }))
    await expectCode(pending.service.sendConnectionRequest(VIEWER_ID, TARGET_ID), 'network_request_exists')

    const accepted = await service(makeRepository({
      findConnectionByPair: vi.fn(async () => connection({ status: 'accepted' })),
    }))
    await expectCode(accepted.service.sendConnectionRequest(VIEWER_ID, TARGET_ID), 'network_already_connected')
  })

  it('creates a pending connection request and its notification in one transaction', async () => {
    const context = await service()

    await expect(context.service.sendConnectionRequest(VIEWER_ID, TARGET_ID)).resolves.toBe(CONNECTION_ID)
    expect(context.repository.insertConnection).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID, VIEWER_ID)
    expect(context.repository.createNotification).toHaveBeenCalledWith({
      recipientId: TARGET_ID,
      actorId: VIEWER_ID,
      type: 'connection_request',
      connectionId: CONNECTION_ID,
    })
    expect(context.transactionSpy).toHaveBeenCalledTimes(1)
  })

  it('allows only the requester to cancel a pending connection request', async () => {
    const allowed = await service(makeRepository({ findConnectionByIdForUpdate: vi.fn(async () => connection()) }))
    await expect(allowed.service.cancelConnectionRequest(VIEWER_ID, CONNECTION_ID)).resolves.toBe(true)
    expect(allowed.repository.deleteConnectionRequestNotification).toHaveBeenCalledWith(CONNECTION_ID)
    expect(allowed.repository.deleteConnection).toHaveBeenCalledWith(CONNECTION_ID)

    const denied = await service(makeRepository({ findConnectionByIdForUpdate: vi.fn(async () => connection()) }))
    await expectCode(denied.service.cancelConnectionRequest(TARGET_ID, CONNECTION_ID), 'network_action_not_allowed')
  })

  it('allows only the recipient to accept or decline a pending request', async () => {
    const accept = await service(makeRepository({ findConnectionByIdForUpdate: vi.fn(async () => connection()) }))
    await expect(accept.service.acceptConnectionRequest(TARGET_ID, CONNECTION_ID)).resolves.toBe(true)
    expect(accept.repository.acceptConnection).toHaveBeenCalledWith(CONNECTION_ID)
    expect(accept.repository.insertMutualFollows).toHaveBeenCalledWith(TARGET_ID, VIEWER_ID)
    expect(accept.repository.createNotification).toHaveBeenCalledWith({
      recipientId: VIEWER_ID,
      actorId: TARGET_ID,
      type: 'connection_accepted',
      connectionId: CONNECTION_ID,
    })

    const requesterAccept = await service(makeRepository({ findConnectionByIdForUpdate: vi.fn(async () => connection()) }))
    await expectCode(requesterAccept.service.acceptConnectionRequest(VIEWER_ID, CONNECTION_ID), 'network_action_not_allowed')

    const decline = await service(makeRepository({ findConnectionByIdForUpdate: vi.fn(async () => connection()) }))
    await expect(decline.service.declineConnectionRequest(TARGET_ID, CONNECTION_ID)).resolves.toBe(true)
    expect(decline.repository.deleteConnection).toHaveBeenCalledWith(CONNECTION_ID)
  })

  it('rechecks readiness and blocking before accepting a connection', async () => {
    const blocked = await service(makeRepository({
      findConnectionByIdForUpdate: vi.fn(async () => connection()),
      isPairBlocked: vi.fn(async () => true),
    }))
    await expectCode(blocked.service.acceptConnectionRequest(TARGET_ID, CONNECTION_ID), 'network_interaction_unavailable')
  })

  it('allows either member to remove an accepted connection but no outsider', async () => {
    const accepted = connection({ status: 'accepted' })
    const member = await service(makeRepository({ findConnectionByIdForUpdate: vi.fn(async () => accepted) }))
    await expect(member.service.removeConnection(TARGET_ID, CONNECTION_ID)).resolves.toBe(true)

    const outsider = await service(makeRepository({ findConnectionByIdForUpdate: vi.fn(async () => accepted) }))
    await expectCode(outsider.service.removeConnection(THIRD_ID, CONNECTION_ID), 'network_action_not_allowed')
  })

  it('blocking is idempotent and tears down follows, requests, notifications and connection state', async () => {
    const context = await service()

    await expect(context.service.block(VIEWER_ID, TARGET_ID)).resolves.toBe(true)
    expect(context.repository.insertBlock).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID)
    expect(context.repository.deletePairRelationships).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID)
  })

  it('unblock only removes blocks owned by the acting member', async () => {
    const context = await service()

    await expect(context.service.unblock(VIEWER_ID, TARGET_ID)).resolves.toBe(true)
    expect(context.repository.deleteBlock).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID)
  })
})
