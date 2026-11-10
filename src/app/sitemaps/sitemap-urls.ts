/**
 * Round H (H5): the sitemap is split by page type. /sitemap.xml is the index; each type is its own
 * sitemap at /sitemaps/sitemap/<type>.xml (Next's generateSitemaps), capped at 50,000 addresses.
 *
 * Only page types that open for signed-out visitors are listed: a search engine cannot index a
 * sign-in redirect. Event and community pages sit behind sign-in today (the (app) layout), so they are
 * left out until they are public. Round ARCH (Phase 2): claimed organizations that members may see
 * listed have a public page and are listed; unclaimed, pending, suspended and rejected ones are not.
 * Member profiles are listed only when the member turned on "Let search engines show my profile".
 */
export const SITEMAP_SECTIONS = ['pages', 'courses', 'jobs', 'people', 'organizations'] as const
export type SitemapSection = (typeof SITEMAP_SECTIONS)[number]

/** Most addresses one sitemap file may hold (sitemaps.org protocol). */
export const SITEMAP_MAX_URLS = 50_000

export function sitemapIndexUrl(origin: string) {
  return `${origin}/sitemap.xml`
}

export function sitemapSectionUrl(origin: string, section: SitemapSection) {
  return `${origin}/sitemaps/sitemap/${section}.xml`
}

function escapeXml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** The sitemap index served at /sitemap.xml: one entry per page-type sitemap. */
export function sitemapIndexXml(origin: string) {
  const entries = SITEMAP_SECTIONS.map((section) => `<sitemap>\n<loc>${escapeXml(sitemapSectionUrl(origin, section))}</loc>\n</sitemap>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</sitemapindex>\n`
}
