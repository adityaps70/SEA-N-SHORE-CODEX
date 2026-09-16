import { describe, expect, it, vi } from 'vitest'
import { createUsernameAvailabilityRepository } from './username-availability'

const viewerId = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'

describe('username availability repository', () => {
  it('returns available when no profile owns the normalized username', async () => {
    const query = vi.fn(async () => [])
    const repository = createUsernameAvailabilityRepository({ query })

    await expect(repository.check(viewerId, ' Captain.Saurabh_01 ')).resolves.toEqual({
      username: 'captain.saurabh_01',
      available: true,
      current: false,
    })
    expect(query).toHaveBeenCalledWith(expect.stringContaining('where slug = $1'), ['captain.saurabh_01'])
  })

  it('treats the current profile username as available', async () => {
    const repository = createUsernameAvailabilityRepository({
      query: vi.fn(async () => [{ id: viewerId }]),
    })

    await expect(repository.check(viewerId, 'captain.saurabh')).resolves.toMatchObject({ available: true, current: true })
  })

  it('marks another profile username as taken', async () => {
    const repository = createUsernameAvailabilityRepository({
      query: vi.fn(async () => [{ id: otherId }]),
    })

    await expect(repository.check(viewerId, 'captain.saurabh')).resolves.toMatchObject({ available: false, current: false })
  })

  it('rejects malformed or reserved usernames before querying', async () => {
    const query = vi.fn(async () => [])
    const repository = createUsernameAvailabilityRepository({ query })

    await expect(repository.check(viewerId, 'jobs')).resolves.toMatchObject({ available: false, valid: false })
    expect(query).not.toHaveBeenCalled()
  })
})
