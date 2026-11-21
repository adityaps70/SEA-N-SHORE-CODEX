/**
 * The public site address for code that runs without NEXT_PUBLIC_SITE_URL (workers, emails built outside a request).
 * It must equal scripts/aws/public-site-url.txt, the one place the site address is set (src/config/public-site.test.ts
 * fails otherwise). Domain move: both change together at the switch.
 */
export const DEFAULT_PUBLIC_SITE_URL = 'https://seanshore.in'
