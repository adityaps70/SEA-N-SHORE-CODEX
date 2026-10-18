import { siteOrigin } from '@/features/learning/course-seo'
import { sitemapIndexXml } from '../sitemaps/sitemap-urls'

// Reads the site address at request time (it differs between local, preview and production).
export const dynamic = 'force-dynamic'

/** Round H (H5): /sitemap.xml is now a sitemap index pointing at one sitemap per page type. */
export function GET() {
  return new Response(sitemapIndexXml(siteOrigin()), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  })
}
