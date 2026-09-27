import { describe, expect, it, vi } from 'vitest'
import { parseProfileNetworkList, profileNetworkListHref } from './profile-network-links'
import { createProfileNetworkStatsRepository, createProfileNetworkStatsService } from './profile-network-stats'

const owner = '11111111-1111-4111-8111-111111111111'
const connection = '22222222-2222-4222-8222-222222222222'
const stranger = '33333333-3333-4333-8333-333333333333'

function serviceWith(connectedPairs: Array<[string, string]> = [[owner, connection]]) {
  const repository = {
    getCounts: vi.fn(async () => ({ connections: 3, followers: 8, following: 2 })),
    areConnected: vi.fn(async (a: string, b: string) => connectedPairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a))),
    listIds: vi.fn(async () => [connection]),
  }
  return { repository, service: createProfileNetworkStatsService(repository) }
}

describe('profile network counts and privacy', () => {
  it('gives signed-out visitors nothing', async () => {
    const { service, repository } = serviceWith()
    await expect(service.getSummary(null, owner)).resolves.toBeNull()
    expect(repository.getCounts).not.toHaveBeenCalled()
  })

  it('lets any signed-in member see the counts but not the lists', async () => {
    const { service } = serviceWith()
    await expect(service.getSummary(stranger, owner)).resolves.toEqual({
      counts: { connections: 3, followers: 8, following: 2 },
      isOwner: false,
      canViewLists: false,
    })
  })

  it('lets the owner and accepted connections open the lists', async () => {
    const { service } = serviceWith()
    await expect(service.getSummary(owner, owner)).resolves.toMatchObject({ isOwner: true, canViewLists: true })
    await expect(service.getSummary(connection, owner)).resolves.toMatchObject({ isOwner: false, canViewLists: true })
  })

  it('returns list members only to allowed viewers', async () => {
    const { service, repository } = serviceWith()
    await expect(service.getListIds(stranger, owner, 'followers')).resolves.toBeNull()
    expect(repository.listIds).not.toHaveBeenCalled()
    await expect(service.getListIds(connection, owner, 'followers')).resolves.toEqual([connection])
    expect(repository.listIds).toHaveBeenCalledWith(owner, 'followers')
  })
})

describe('profile network repository', () => {
  it('counts only accepted connections and active, onboarded members', async () => {
    const query = vi.fn(async () => [{ connections: '4', followers: '12', following: '0' }])
    const repository = createProfileNetworkStatsRepository({ query })

    await expect(repository.getCounts(owner)).resolves.toEqual({ connections: 4, followers: 12, following: 0 })
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toContain("c.status = 'accepted'")
    expect(sql).toContain("o.account_status = 'active'")
    expect(sql).toContain('o.onboarding_completed_at is not null')
    expect(sql).toContain('f.following_id = $1')
    expect(sql).toContain('f.follower_id = $1')
    expect(values).toEqual([owner])
  })

  it('checks connection status using the canonical pair order', async () => {
    const query = vi.fn(async () => [{ id: 'connection-1' }])
    const repository = createProfileNetworkStatsRepository({ query })

    await expect(repository.areConnected(connection, owner)).resolves.toBe(true)
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'accepted'"), [owner, connection])
    await expect(repository.areConnected(owner, owner)).resolves.toBe(false)
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('reads each list newest first with a bounded page size', async () => {
    const query = vi.fn(async () => [{ id: connection }])
    const repository = createProfileNetworkStatsRepository({ query })

    await expect(repository.listIds(owner, 'following')).resolves.toEqual([connection])
    expect(query).toHaveBeenCalledWith(expect.stringContaining('f.following_id as id'), [owner, 100])
  })
})

describe('profile network links', () => {
  it('sends the owner to their own network hub and others to the member list page', () => {
    expect(profileNetworkListHref('connections', { isOwner: true, slug: 'asha' })).toBe('/network?tab=connections')
    expect(profileNetworkListHref('followers', { isOwner: true, slug: 'asha' })).toBe('/network?tab=following&view=followers')
    expect(profileNetworkListHref('following', { isOwner: true, slug: 'asha' })).toBe('/network?tab=following&view=following')
    expect(profileNetworkListHref('followers', { isOwner: false, slug: 'asha.singh' })).toBe('/people/asha.singh/network?view=followers')
  })

  it('falls back to connections for unknown list names', () => {
    expect(parseProfileNetworkList('followers')).toBe('followers')
    expect(parseProfileNetworkList('admins')).toBe('connections')
    expect(parseProfileNetworkList(undefined)).toBe('connections')
  })
})
