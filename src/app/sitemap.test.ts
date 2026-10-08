import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ listPublicCourseUrls: vi.fn() }))

vi.mock('@/features/learning/public-course-repository', () => ({
  publicCourseRepository: { listPublicCourseUrls: mocks.listPublicCourseUrls },
}))

import robots from './robots'
import sitemap from './sitemap'

describe('sitemap.xml and robots.txt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://seanshore.in/')
  })

  it('lists the public pages and every public course', async () => {
    mocks.listPublicCourseUrls.mockResolvedValue([{ slug: 'sire-2-readiness', updatedAt: '2026-10-01T08:00:00.000Z' }])

    const entries = await sitemap()

    const urls = entries.map((entry) => entry.url)
    expect(urls).toEqual(expect.arrayContaining(['https://seanshore.in', 'https://seanshore.in/learn', 'https://seanshore.in/pricing']))
    expect(entries).toContainEqual({ url: 'https://seanshore.in/learn/courses/sire-2-readiness', lastModified: '2026-10-01T08:00:00.000Z', changeFrequency: 'weekly', priority: 0.8 })
    expect(urls.some((url) => /\/(auth|admin|api|home)\b|\/preview\//.test(url))).toBe(false)
  })

  it('still lists the fixed pages if the course lookup fails', async () => {
    mocks.listPublicCourseUrls.mockRejectedValue(new Error('db down'))
    const urls = (await sitemap()).map((entry) => entry.url)
    expect(urls).toContain('https://seanshore.in/learn')
    expect(urls.some((url) => url.includes('/learn/courses/'))).toBe(false)
  })

  it('keeps crawlers out of sign-in, APIs and member areas, and points them at the sitemap', () => {
    expect(robots()).toEqual({
      rules: expect.objectContaining({ userAgent: '*', allow: '/', disallow: expect.arrayContaining(['/api/', '/auth/', '/admin', '/learn/my-learning', '/learn/courses/*/learn']) }),
      sitemap: 'https://seanshore.in/sitemap.xml',
    })
    const disallow = (robots().rules as { disallow: string[] }).disallow
    expect(disallow).not.toContain('/learn')
    // Previews must stay fetchable so crawlers see their noindex.
    expect(disallow.some((rule) => rule.includes('preview'))).toBe(false)
  })
})
