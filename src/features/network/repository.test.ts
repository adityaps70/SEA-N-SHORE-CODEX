import { describe, expect, it, vi } from 'vitest'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const TARGET_ID = '22222222-2222-4222-8222-222222222222'
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333'

describe('Aurora network repository', () => {
  it('loads viewer follows and connections through permanent profile UUIDs', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ following_id: TARGET_ID }])
      .mockResolvedValueOnce([{
        id: CONNECTION_ID,
        user_low_id: VIEWER_ID,
        user_high_id: TARGET_ID,
        requested_by: VIEWER_ID,
        status: 'pending',
        created_at: '2026-09-01T10:00:00.000Z',
        updated_at: '2026-09-01T10:00:00.000Z',
      }])
    const { createNetworkRepository } = await import('./repository')
    const repository = createNetworkRepository({ query })

    await expect(repository.loadViewerGraph(VIEWER_ID)).resolves.toEqual({
      followedIds: new Set([TARGET_ID]),
      connections: [expect.objectContaining({ id: CONNECTION_ID, status: 'pending' })],
    })

    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('from public.follows'),
      [VIEWER_ID],
    )
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('from public.connections'),
      [VIEWER_ID],
    )
  })

  it('checks member readiness and symmetric blocking with parameterized SQL', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ ready: true }])
      .mockResolvedValueOnce([{ blocked: true }])
    const { createNetworkRepository } = await import('./repository')
    const repository = createNetworkRepository({ query })

    await expect(repository.isMemberReady(VIEWER_ID)).resolves.toBe(true)
    await expect(repository.isPairBlocked(VIEWER_ID, TARGET_ID)).resolves.toBe(true)

    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining("p.account_status = 'active'"), [VIEWER_ID])
    const blockSql = String(query.mock.calls[1]?.[0])
    expect(blockSql).toContain('from public.user_blocks')
    expect(blockSql).toContain('blocker_id = $1 and blocked_id = $2')
    expect(blockSql).toContain('blocker_id = $2 and blocked_id = $1')
  })

  it('uses canonical pair ordering when loading a connection by member pair', async () => {
    const query = vi.fn(async () => [])
    const { createNetworkRepository } = await import('./repository')
    const repository = createNetworkRepository({ query })

    await repository.findConnectionByPair(TARGET_ID, VIEWER_ID)

    const [low, high] = [VIEWER_ID, TARGET_ID].sort()
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('user_low_id = $1 and user_high_id = $2'),
      [low, high],
    )
  })

  it('locks connection rows for lifecycle authorization', async () => {
    const query = vi.fn(async () => [])
    const { createNetworkRepository } = await import('./repository')
    const repository = createNetworkRepository({ query })

    await repository.findConnectionByIdForUpdate(CONNECTION_ID)

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('for update'),
      [CONNECTION_ID],
    )
  })

  it('creates follow and connection notifications with explicit recipients', async () => {
    const query = vi.fn(async () => [])
    const { createNetworkRepository } = await import('./repository')
    const repository = createNetworkRepository({ query })

    await repository.createNotification({
      recipientId: TARGET_ID,
      actorId: VIEWER_ID,
      type: 'new_follower',
    })
    await repository.createNotification({
      recipientId: TARGET_ID,
      actorId: VIEWER_ID,
      type: 'connection_request',
      connectionId: CONNECTION_ID,
    })

    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('insert into public.notifications'),
      [TARGET_ID, VIEWER_ID, 'new_follower', null],
    )
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('insert into public.notifications'),
      [TARGET_ID, VIEWER_ID, 'connection_request', CONNECTION_ID],
    )
  })

  it('removes both directional follows and the canonical connection when blocking', async () => {
    const query = vi.fn(async () => [])
    const { createNetworkRepository } = await import('./repository')
    const repository = createNetworkRepository({ query })

    await repository.deletePairRelationships(VIEWER_ID, TARGET_ID)

    const [low, high] = [VIEWER_ID, TARGET_ID].sort()
    expect(String(query.mock.calls[0]?.[0])).toContain('delete from public.follows')
    expect(query.mock.calls[0]?.[1]).toEqual([VIEWER_ID, TARGET_ID])
    expect(String(query.mock.calls[1]?.[0])).toContain('delete from public.notifications')
    expect(query.mock.calls[1]?.[1]).toEqual([low, high])
    expect(String(query.mock.calls[2]?.[0])).toContain('delete from public.connections')
    expect(query.mock.calls[2]?.[1]).toEqual([low, high])
  })
})
