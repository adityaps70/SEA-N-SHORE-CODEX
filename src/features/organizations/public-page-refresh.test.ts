import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invalidate: vi.fn(), getSlugById: vi.fn(), getSlugByCourseId: vi.fn() }))
vi.mock('@/lib/edge/cloudfront-invalidation', () => ({ invalidateOrganizationPage: mocks.invalidate }))
vi.mock('./workspace-repository', () => ({ organizationWorkspaceRepository: { getSlugById: mocks.getSlugById, getSlugByCourseId: mocks.getSlugByCourseId } }))

import { clearOrganizationPublicPage } from './public-page-refresh'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('APP_CLOUDFRONT_DISTRIBUTION_ID', 'E2EXAMPLE')
  mocks.invalidate.mockResolvedValue('sent')
  mocks.getSlugById.mockResolvedValue('harbour-minds')
})
afterEach(() => vi.unstubAllEnvs())

describe('clearing an organization\'s public page (Round ARCH, Phase 2)', () => {
  it('clears by slug, by a lookup, by organization id or by a course it publishes', async () => {
    mocks.getSlugByCourseId.mockResolvedValueOnce('course-publisher').mockResolvedValueOnce(null)
    await clearOrganizationPublicPage({ slug: 'oceanic' })
    await clearOrganizationPublicPage({ resolveSlug: async () => 'from-lookup' }, { immediate: true })
    await clearOrganizationPublicPage({ companyId: 'c1' })
    await clearOrganizationPublicPage({ courseId: 'course-1' })
    await clearOrganizationPublicPage({ courseId: 'personal-course' })
    expect(mocks.invalidate.mock.calls).toEqual([['oceanic', {}], ['from-lookup', { immediate: true }], ['harbour-minds', {}], ['course-publisher', {}]])
    expect(mocks.getSlugByCourseId).toHaveBeenCalledWith('course-1')
    expect(mocks.getSlugById).toHaveBeenCalledWith('c1')
  })

  it('looks nothing up and sends nothing when CloudFront clearing is not configured', async () => {
    vi.stubEnv('APP_CLOUDFRONT_DISTRIBUTION_ID', '')
    const resolveSlug = vi.fn(async () => 'x')
    await clearOrganizationPublicPage({ companyId: 'c1', resolveSlug })
    expect(resolveSlug).not.toHaveBeenCalled()
    expect(mocks.getSlugById).not.toHaveBeenCalled()
    expect(mocks.invalidate).not.toHaveBeenCalled()
  })

  it('never throws, so it never fails the edit', async () => {
    mocks.getSlugById.mockRejectedValue(new Error('db down'))
    await expect(clearOrganizationPublicPage({ companyId: 'c1' })).resolves.toBeUndefined()
    mocks.invalidate.mockRejectedValue(new Error('boom'))
    await expect(clearOrganizationPublicPage({ slug: 'oceanic' })).resolves.toBeUndefined()
    await expect(clearOrganizationPublicPage({ resolveSlug: async () => { throw new Error('nope') } })).resolves.toBeUndefined()
  })

  it('does nothing for an organization it cannot find', async () => {
    mocks.getSlugById.mockResolvedValue(null)
    await clearOrganizationPublicPage({ companyId: 'missing' })
    await clearOrganizationPublicPage({})
    expect(mocks.invalidate).not.toHaveBeenCalled()
  })
})
