import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listPublicCourseUrls: vi.fn(),
  listSitemapJobs: vi.fn(),
  listSearchIndexableProfiles: vi.fn(),
}))

vi.mock('@/features/learning/public-course-repository', () => ({
  publicCourseRepository: { listPublicCourseUrls: mocks.listPublicCourseUrls },
}))
vi.mock('@/features/jobs/repository', () => ({ listSitemapJobs: mocks.listSitemapJobs }))
vi.mock('@/features/profiles/repository', () => ({ listSearchIndexableProfiles: mocks.listSearchIndexableProfiles }))

import robots from './robots'
import { GET as sitemapIndex } from './sitemap.xml/route'
import sitemap, { generateSitemaps } from './sitemaps/sitemap'

/** Round H (H5): /sitemap.xml is an index; each page type is its own sitemap. */
async function allEntries() {
  const sections = await generateSitemaps()
  const lists = await Promise.all(sections.map(({ id }) => sitemap({ id: Promise.resolve(id) })))
  return lists.flat()
}

describe('sitemap.xml and robots.txt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://seanshore.in/')
    mocks.listPublicCourseUrls.mockResolvedValue([])
    mocks.listSitemapJobs.mockResolvedValue([])
    mocks.listSearchIndexableProfiles.mockResolvedValue([])
  })

  it('lists the public pages and every public course', async () => {
    mocks.listPublicCourseUrls.mockResolvedValue([{ slug: 'sire-2-readiness', updatedAt: '2026-10-01T08:00:00.000Z' }])

    const entries = await allEntries()

    const urls = entries.map((entry) => entry.url)
    expect(urls).toEqual(expect.arrayContaining(['https://seanshore.in', 'https://seanshore.in/learn', 'https://seanshore.in/pricing']))
    expect(entries).toContainEqual({ url: 'https://seanshore.in/learn/courses/sire-2-readiness', lastModified: '2026-10-01T08:00:00.000Z', changeFrequency: 'weekly', priority: 0.8 })
    expect(urls.some((url) => /\/(auth|admin|api|home)\b|\/preview\//.test(url))).toBe(false)
  })

  it('still lists the fixed pages if the course lookup fails', async () => {
    mocks.listPublicCourseUrls.mockRejectedValue(new Error('db down'))
    const urls = (await allEntries()).map((entry) => entry.url)
    expect(urls).toContain('https://seanshore.in/learn')
    expect(urls.some((url) => url.includes('/learn/courses/'))).toBe(false)
  })

  it('splits by page type: pages, courses, jobs and public profiles', async () => {
    expect(await generateSitemaps()).toEqual([{ id: 'pages' }, { id: 'courses' }, { id: 'jobs' }, { id: 'people' }])
    mocks.listSitemapJobs.mockResolvedValue([{ id: 'job-1', updatedAt: '2026-10-10T00:00:00.000Z' }])

    const jobs = await sitemap({ id: Promise.resolve('jobs') })
    expect(jobs).toEqual([{ url: 'https://seanshore.in/jobs/job-1', lastModified: '2026-10-10T00:00:00.000Z', changeFrequency: 'daily', priority: 0.8 }])
    expect(mocks.listSitemapJobs).toHaveBeenCalledWith(50_000)
    const pages = (await sitemap({ id: Promise.resolve('pages') })).map((entry) => entry.url)
    expect(pages).toContain('https://seanshore.in/jobs')
    expect(pages.every((url) => !url.includes('/jobs/'))).toBe(true)
    expect(await sitemap({ id: Promise.resolve('unknown') })).toEqual([])
  })

  it('lists a live job and only the profiles whose owner allowed search engines', async () => {
    mocks.listSitemapJobs.mockResolvedValue([{ id: 'live-job', updatedAt: '2026-10-12T00:00:00.000Z' }])
    // The repository returns opted-in profiles only; a profile without the opt-in never reaches the sitemap.
    mocks.listSearchIndexableProfiles.mockResolvedValue([{ slug: 'opted-in-member', updatedAt: '2026-10-05T00:00:00.000Z' }])

    const urls = (await allEntries()).map((entry) => entry.url)

    expect(urls).toContain('https://seanshore.in/jobs/live-job')
    expect(urls).toContain('https://seanshore.in/people/opted-in-member')
    expect(urls).not.toContain('https://seanshore.in/people/not-opted-in')
    expect(mocks.listSearchIndexableProfiles).toHaveBeenCalledWith(50_000)
  })

  it('leaves out organization, event and community pages while they need sign-in', async () => {
    const urls = (await allEntries()).map((entry) => entry.url)
    expect(urls.some((url) => /\/(organizations|events|community)(\/|$)/.test(url))).toBe(false)
  })

  it('keeps the other sitemaps when one lookup fails', async () => {
    mocks.listSitemapJobs.mockRejectedValue(new Error('db down'))
    mocks.listSearchIndexableProfiles.mockRejectedValue(new Error('db down'))
    expect(await sitemap({ id: Promise.resolve('jobs') })).toEqual([])
    expect(await sitemap({ id: Promise.resolve('people') })).toEqual([])
    expect((await sitemap({ id: Promise.resolve('pages') })).length).toBeGreaterThan(5)
  })

  it('serves /sitemap.xml as an index of every per-type sitemap', async () => {
    const response = sitemapIndex()
    expect(response.headers.get('Content-Type')).toContain('application/xml')
    const xml = await response.text()
    expect(xml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    for (const id of ['pages', 'courses', 'jobs', 'people']) {
      expect(xml).toContain(`<loc>https://seanshore.in/sitemaps/sitemap/${id}.xml</loc>`)
    }
  })

  it('keeps crawlers out of sign-in, APIs and member areas, and points them at the sitemaps', () => {
    expect(robots()).toEqual({
      rules: expect.objectContaining({ userAgent: '*', allow: '/', disallow: expect.arrayContaining(['/api/', '/auth/', '/admin', '/learn/my-learning', '/learn/courses/*/learn']) }),
      sitemap: [
        'https://seanshore.in/sitemap.xml',
        'https://seanshore.in/sitemaps/sitemap/pages.xml',
        'https://seanshore.in/sitemaps/sitemap/courses.xml',
        'https://seanshore.in/sitemaps/sitemap/jobs.xml',
        'https://seanshore.in/sitemaps/sitemap/people.xml',
      ],
    })
    const disallow = (robots().rules as { disallow: string[] }).disallow
    expect(disallow).not.toContain('/learn')
    // Round H (H5): job and profile pages stay crawlable.
    expect(disallow.some((rule) => rule.startsWith('/jobs') || rule.startsWith('/people'))).toBe(false)
    // Previews must stay fetchable so crawlers see their noindex.
    expect(disallow.some((rule) => rule.includes('preview'))).toBe(false)
  })
})
