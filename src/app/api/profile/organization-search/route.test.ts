import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class AwsAuthenticationRequiredError extends Error {
    constructor() {
      super('Authentication required.')
      this.name = 'AwsAuthenticationRequiredError'
    }
  }
  return {
    AwsAuthenticationRequiredError,
    requireAwsUser: vi.fn(),
    searchListableOrganizations: vi.fn(),
  }
})

vi.mock('@/features/auth/aws-queries', () => ({
  AwsAuthenticationRequiredError: mocks.AwsAuthenticationRequiredError,
  requireAwsUser: mocks.requireAwsUser,
}))
vi.mock('@/features/profiles/organization-link-repository', () => ({
  organizationLinkRepository: { searchListableOrganizations: mocks.searchListableOrganizations },
}))

import { GET } from './route'

const organization = {
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'oceanic-ship-management',
  name: 'Oceanic Ship Management',
  logoUrl: null,
  verified: true,
  type: 'Ship manager',
  location: 'Mumbai, India',
}

describe('GET /api/profile/organization-search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' })
    mocks.searchListableOrganizations.mockResolvedValue([organization])
  })

  it('returns listed organizations for a signed-in member without caching', async () => {
    const response = await GET(new Request('https://seanshore.test/api/profile/organization-search?q=ocean'))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual({ query: 'ocean', organizations: [organization] })
    expect(mocks.searchListableOrganizations).toHaveBeenCalledWith('ocean')
  })

  it('requires sign-in', async () => {
    mocks.requireAwsUser.mockRejectedValueOnce(new mocks.AwsAuthenticationRequiredError())

    const response = await GET(new Request('https://seanshore.test/api/profile/organization-search?q=ocean'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Please sign in again to search organizations.' })
    expect(mocks.searchListableOrganizations).not.toHaveBeenCalled()
  })

  it('explains a failed search in plain words', async () => {
    mocks.searchListableOrganizations.mockRejectedValueOnce(new Error('connection reset'))

    const response = await GET(new Request('https://seanshore.test/api/profile/organization-search?q=ocean'))

    expect(response.status).toBe(500)
    const body = await response.json() as { error: string }
    expect(body.error).toContain('keep typing the name')
    expect(body.error).not.toContain('connection reset')
  })

  it('slows down a member who searches too often', async () => {
    let last: Response | null = null
    for (let index = 0; index < 61; index += 1) {
      last = await GET(new Request(`https://seanshore.test/api/profile/organization-search?q=ocean${index}`))
    }
    expect(last?.status).toBe(429)
    expect(last?.headers.get('retry-after')).toBe('30')
  })
})
