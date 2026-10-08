import type { MetadataRoute } from 'next'
import { siteOrigin } from '@/features/learning/course-seo'

// Reads the site address at request time (it differs between local, preview and production).
export const dynamic = 'force-dynamic'

export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin()
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Sign-in, APIs and member-only areas. The public catalogue and course pages stay crawlable;
      // free previews are crawlable too but carry noindex, which crawlers only see if they may fetch them.
      disallow: [
        '/api/',
        '/auth/',
        '/admin',
        '/onboarding',
        '/learn/my-learning',
        '/learn/studio',
        '/learn/teach',
        '/learn/courses/*/learn',
      ],
    },
    sitemap: `${origin}/sitemap.xml`,
  }
}
