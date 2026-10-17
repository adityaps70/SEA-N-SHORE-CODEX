import type { MetadataRoute } from 'next'
import { listSitemapJobs } from '@/features/jobs/repository'
import { siteOrigin } from '@/features/learning/course-seo'
import { publicCourseRepository } from '@/features/learning/public-course-repository'
import { listSearchIndexableProfiles } from '@/features/profiles/repository'
import { SITEMAP_MAX_URLS } from './sitemap-urls'

/** Public pages anyone can read. Signed-in pages, previews and member-only areas are left out. */
const PUBLIC_PAGES: Array<{ path: string; changeFrequency: 'daily' | 'weekly' | 'monthly' | 'yearly'; priority: number }> = [
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/learn', changeFrequency: 'daily', priority: 0.9 },
  // Round H (H5): the jobs list opens for signed-out visitors (each live job is in the jobs sitemap).
  { path: '/jobs', changeFrequency: 'daily', priority: 0.9 },
  { path: '/pricing', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/about', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/help', changeFrequency: 'monthly', priority: 0.5 },
  { path: '/contact', changeFrequency: 'yearly', priority: 0.4 },
  { path: '/newsletter', changeFrequency: 'monthly', priority: 0.4 },
  { path: '/accessibility', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/refunds', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/shipping', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/copyright', changeFrequency: 'yearly', priority: 0.2 },
]

/**
 * Addresses for one sitemap. A failed lookup gives an empty sitemap rather than an error, so the other
 * types (and the fixed pages) are still served.
 */
export async function sitemapSectionEntries(section: string): Promise<MetadataRoute.Sitemap> {
  const origin = siteOrigin()
  switch (section) {
    case 'pages':
      return PUBLIC_PAGES.map((page) => ({
        url: `${origin}${page.path === '/' ? '' : page.path}`,
        changeFrequency: page.changeFrequency,
        priority: page.priority,
      }))
    case 'courses': {
      const courses = await publicCourseRepository.listPublicCourseUrls(SITEMAP_MAX_URLS).catch(() => [])
      return courses.slice(0, SITEMAP_MAX_URLS).map((course) => ({
        url: `${origin}/learn/courses/${encodeURIComponent(course.slug)}`,
        lastModified: course.updatedAt,
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      }))
    }
    case 'jobs': {
      // Published, live jobs only: closed, expired and removed jobs never reach this list.
      const jobs = await listSitemapJobs(SITEMAP_MAX_URLS).catch(() => [])
      return jobs.slice(0, SITEMAP_MAX_URLS).map((job) => ({
        url: `${origin}/jobs/${encodeURIComponent(job.id)}`,
        lastModified: job.updatedAt,
        changeFrequency: 'daily' as const,
        priority: 0.8,
      }))
    }
    case 'people': {
      const profiles = await listSearchIndexableProfiles(SITEMAP_MAX_URLS).catch(() => [])
      return profiles.slice(0, SITEMAP_MAX_URLS).map((profile) => ({
        url: `${origin}/people/${encodeURIComponent(profile.slug)}`,
        lastModified: profile.updatedAt,
        changeFrequency: 'weekly' as const,
        priority: 0.5,
      }))
    }
    default:
      return []
  }
}
