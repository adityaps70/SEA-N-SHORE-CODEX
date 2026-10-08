import type { MetadataRoute } from 'next'
import { siteOrigin } from '@/features/learning/course-seo'
import { publicCourseRepository } from '@/features/learning/public-course-repository'

// Built per request: published courses come from the database, which isn't reachable at build time.
export const dynamic = 'force-dynamic'

/** Public pages anyone can read. Signed-in pages, previews and member profiles are left out. */
const PUBLIC_PAGES: Array<{ path: string; changeFrequency: 'daily' | 'weekly' | 'monthly' | 'yearly'; priority: number }> = [
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/learn', changeFrequency: 'daily', priority: 0.9 },
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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteOrigin()
  // The fixed pages are still listed if the course lookup fails.
  const courses = await publicCourseRepository.listPublicCourseUrls().catch(() => [])
  return [
    ...PUBLIC_PAGES.map((page) => ({
      url: `${origin}${page.path === '/' ? '' : page.path}`,
      changeFrequency: page.changeFrequency,
      priority: page.priority,
    })),
    ...courses.map((course) => ({
      url: `${origin}/learn/courses/${encodeURIComponent(course.slug)}`,
      lastModified: course.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ]
}
