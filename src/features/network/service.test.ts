import { describe, expect, it, vi } from 'vitest'
import type { NetworkRepository } from './repository'
import type { OutboxRepository } from '@/features/events/outbox-repository'

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

function makeOutbox() {
  return {
    enqueue: vi.fn(async () => undefined),
  }
}

async function service(repo = makeRepository(), outbox = makeOutbox()) {
  const { createNetworkService } = await import('./service')
  const transactionSpy = vi.fn()
  const withTransaction = async <T>(
    fn: (repositories: { network: NetworkRepository; outbox: OutboxRepository }) => Promise<T>,
  ) => {
    transactionSpy()
    return fn({
      network: repo as unknown as NetworkRepository,
      outbox: outbox as unknown as OutboxRepository,
    })
  }
  return {
    service: createNetworkService({ withTransaction }),
    repository: repo,
    outbox,
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
    expect(context.outbox.enqueue).not.toHaveBeenCalled()
  })

  it('rejects follow and connection creation when either member is unavailable or the pair is blocked', async () => {
    const unavailable = await service(makeRepository({ isMemberReady: vi.fn(async (id: string) => id !== TARGET_ID) }))
    await expectCode(unavailable.service.follow(VIEWER_ID, TARGET_ID), 'network_interaction_unavailable')
    expect(unavailable.outbox.enqueue).not.toHaveBeenCalled()

    const blocked = await service(makeRepository({ isPairBlocked: vi.fn(async () => true) }))
    await expectCode(blocked.service.sendConnectionRequest(VIEWER_ID, TARGET_ID), 'network_interaction_unavailable')
    expect(blocked.outbox.enqueue).not.toHaveBeenCalled()
  })

  it('creates a new follower notification and shadow event only when the follow row is newly inserted', async () => {
    const created = await service()
    await expect(created.service.follow(VIEWER_ID, TARGET_ID)).resolves.toBe(true)
    expect(created.repository.createNotification).toHaveBeenCalledWith({
      recipientId: TARGET_ID,
      actorId: VIEWER_ID,
      type: 'new_follower',
    })
    expect(created.outbox.enqueue).toHaveBeenCalledTimes(1)
    expect(created.outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      aggregateType: 'profile',
      aggregateId: TARGET_ID,
      eventType: 'user.followed',
      schemaVersion: 1,
      payload: {
        eventType: 'user.followed',
        actorId: VIEWER_ID,
        targetId: TARGET_ID,
      },
    }))

    const existing = await service(makeRepository({ insertFollow: vi.fn(async () => false) }))
    await expect(existing.service.follow(VIEWER_ID, TARGET_ID)).resolves.toBe(false)
    expect(existing.repository.createNotification).not.toHaveBeenCalled()
    expect(existing.outbox.enqueue).not.toHaveBeenCalled()
  })

  it('preserves connection duplicate and already-connected error semantics without emitting events', async () => {
    const pending = await service(makeRepository({ findConnectionByPair: vi.fn(async () => connection()) }))
    await expectCode(pending.service.sendConnectionRequest(VIEWER_ID, TARGET_ID), 'network_request_exists')
    expect(pending.outbox.enqueue).not.toHaveBeenCalled()

    const accepted = await service(makeRepository({
      findConnectionByPair: vi.fn(async () => connection({ status: 'accepted' })),
    }))
    await expectCode(accepted.service.sendConnectionRequest(VIEWER_ID, TARGET_ID), 'network_already_connected')
    expect(accepted.outbox.enqueue).not.toHaveBeenCalled()
  })

  it('creates a pending connection request, shadow event and notification in one transaction', async () => {
    const context = await service()

    await expect(context.service.sendConnectionRequest(VIEWER_ID, TARGET_ID)).resolves.toBe(CONNECTION_ID)
    expect(context.repository.insertConnection).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID, VIEWER_ID)
    expect(context.outbox.enqueue).toHaveBeenCalledTimes(1)
    expect(context.outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      aggregateType: 'connection',
      aggregateId: CONNECTION_ID,
      eventType: 'connection.requested',
      payload: {
        eventType: 'connection.requested',
        actorId: VIEWER_ID,
        targetId: TARGET_ID,
        connectionId: CONNECTION_ID,
      },
    }))
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
    expect(allowed.outbox.enqueue).not.toHaveBeenCalled()

    const denied = await service(makeRepository({ findConnectionByIdForUpdate: vi.fn(async () => connection()) }))
    await expectCode(denied.service.cancelConnectionRequest(TARGET_ID, CONNECTION_ID), 'network_action_not_allowed')
    expect(denied.outbox.enqueue).not.toHaveBeenCalled()
  })

  it('allows only the recipient to accept or decline a pending request and emits acceptance once', async () => {
    const accept = await service(makeRepository({ findConnectionByIdForUpdate: vi.fn(async () => connection()) }))
    await expect(accept.service.acceptConnectionRequest(TARGET_ID, CONNECTION_ID)).resolves.toBe(true)
    expect(accept.repository.acceptConnection).toHaveBeenCalledWith(CONNECTION_ID)
    expect(accept.repository.insertMutualFollows).toHaveBeenCalledWith(TARGET_ID, VIEWER_ID)
    expect(accept.outbox.enqueue).toHaveBeenCalledTimes(1)
    expect(accept.outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      aggregateType: 'connection',
      aggregateId: CONNECTION_ID,
      eventType: 'connection.accepted',
      payload: {
        eventType: 'connection.accepted',
        actorId: TARGET_ID,
        targetId: VIEWER_ID,
        connectionId: CONNECTION_ID,
        requestedBy: VIEWER_ID,
      },
    }))
    expect(accept.repository.createNotification).toHaveBeenCalledWith({
      recipientId: VIEWER_ID,
      actorId: TARGET_ID,
      type: 'connection_accepted',
      connectionId: CONNECTION_ID,
    })

    const requesterAccept = await service(makeRepository({ findConnectionByIdForUpdate: vi.fn(async () => connection()) }))
    await expectCode(requesterAccept.service.acceptConnectionRequest(VIEWER_ID, CONNECTION_ID), 'network_action_not_allowed')
    expect(requesterAccept.outbox.enqueue).not.toHaveBeenCalled()

    const decline = await service(makeRepository({ findConnectionByIdForUpdate: vi.fn(async () => connection()) }))
    await expect(decline.service.declineConnectionRequest(TARGET_ID, CONNECTION_ID)).resolves.toBe(true)
    expect(decline.repository.deleteConnection).toHaveBeenCalledWith(CONNECTION_ID)
    expect(decline.outbox.enqueue).not.toHaveBeenCalled()
  })

  it('rechecks readiness and blocking before accepting a connection', async () => {
    const blocked = await service(makeRepository({
      findConnectionByIdForUpdate: vi.fn(async () => connection()),
      isPairBlocked: vi.fn(async () => true),
    }))
    await expectCode(blocked.service.acceptConnectionRequest(TARGET_ID, CONNECTION_ID), 'network_interaction_unavailable')
    expect(blocked.outbox.enqueue).not.toHaveBeenCalled()
  })

  it('allows either member to remove an accepted connection but no outsider', async () => {
    const accepted = connection({ status: 'accepted' })
    const member = await service(makeRepository({ findConnectionByIdForUpdate: vi.fn(async () => accepted) }))
    await expect(member.service.removeConnection(TARGET_ID, CONNECTION_ID)).resolves.toBe(true)
    expect(member.outbox.enqueue).not.toHaveBeenCalled()

    const outsider = await service(makeRepository({ findConnectionByIdForUpdate: vi.fn(async () => accepted) }))
    await expectCode(outsider.service.removeConnection(THIRD_ID, CONNECTION_ID), 'network_action_not_allowed')
    expect(outsider.outbox.enqueue).not.toHaveBeenCalled()
  })

  it('blocking is idempotent and tears down follows, requests, notifications and connection state', async () => {
    const context = await service()

    await expect(context.service.block(VIEWER_ID, TARGET_ID)).resolves.toBe(true)
    expect(context.repository.insertBlock).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID)
    expect(context.repository.deletePairRelationships).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID)
    expect(context.outbox.enqueue).not.toHaveBeenCalled()
  })

  it('unblock only removes blocks owned by the acting member', async () => {
    const context = await service()

    await expect(context.service.unblock(VIEWER_ID, TARGET_ID)).resolves.toBe(true)
    expect(context.repository.deleteBlock).toHaveBeenCalledWith(VIEWER_ID, TARGET_ID)
    expect(context.outbox.enqueue).not.toHaveBeenCalled()
  })
})
