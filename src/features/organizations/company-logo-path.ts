/**
 * Request cuts (owner-approved 18 Nov): where an organization's logo is served from.
 *
 * - A verified organization's logo is a public brand image. When the caller already knows the organization is
 *   verified it links the cookie-free public route, which CloudFront caches once for everyone
 *   (infra/aws/app/edge.tf, `/api/public/company-logo/*`).
 * - Every other logo stays on the signed-in route, which checks the viewer and is never shared between sessions.
 *
 * The public route checks verification itself and answers 404 for anything else, so a stale flag can only ever
 * show the initials, never an unverified logo.
 */
export const SIGNED_IN_COMPANY_LOGO_PREFIX = '/api/company-logo/'
export const PUBLIC_COMPANY_LOGO_PREFIX = '/api/public/company-logo/'

/**
 * How long a browser and CloudFront may each keep the public route's answer. The answer is usually a redirect to a
 * signed CDN URL, valid for at least one signing window (6 hours for the shortest, see src/lib/media-cdn/signer.ts),
 * so a cached redirect (browser plus edge, at most twice this) always points at a URL that still works. The edge
 * cache policy caps it too (max_ttl in edge.tf).
 */
export const PUBLIC_COMPANY_LOGO_MAX_AGE_SECONDS = 60 * 60
export const PUBLIC_COMPANY_LOGO_CACHE_CONTROL = `public, max-age=${PUBLIC_COMPANY_LOGO_MAX_AGE_SECONDS}, s-maxage=${PUBLIC_COMPANY_LOGO_MAX_AGE_SECONDS}`

/** Same-origin logo path: the public route only when `verified` is exactly true. */
export function companyLogoPath(companyId: string, options: { verified?: boolean | null } = {}) {
  return `${options.verified === true ? PUBLIC_COMPANY_LOGO_PREFIX : SIGNED_IN_COMPANY_LOGO_PREFIX}${companyId}`
}
