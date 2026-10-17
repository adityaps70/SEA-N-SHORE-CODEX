import { siteUrlFor } from '@/lib/site-url'

// Expires is computed per request, so the file never goes stale.
export const dynamic = 'force-dynamic'

const CONTACT = 'mailto:operations@beaufortmarine.in'
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000

/** Round H (H4): RFC 9116 security.txt, telling researchers where to report vulnerabilities. */
export function GET() {
  const expires = new Date(Date.now() + ONE_YEAR_MS)
  expires.setUTCHours(0, 0, 0, 0)
  const body = [
    `Contact: ${CONTACT}`,
    `Expires: ${expires.toISOString()}`,
    'Preferred-Languages: en',
    `Canonical: ${siteUrlFor('/.well-known/security.txt').toString()}`,
    '',
  ].join('\n')
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
