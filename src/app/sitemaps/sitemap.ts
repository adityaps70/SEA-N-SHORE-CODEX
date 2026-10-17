import type { MetadataRoute } from 'next'
import { sitemapSectionEntries } from './sitemap-sections'
import { SITEMAP_SECTIONS } from './sitemap-urls'

// Built per request: jobs, courses and profiles come from the database, which isn't reachable at build time.
export const dynamic = 'force-dynamic'

/** Round H (H5): one sitemap per page type, at /sitemaps/sitemap/<type>.xml; /sitemap.xml lists them all. */
export async function generateSitemaps() {
  return SITEMAP_SECTIONS.map((id) => ({ id }))
}

export default async function sitemap(props: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  return sitemapSectionEntries(await props.id)
}
