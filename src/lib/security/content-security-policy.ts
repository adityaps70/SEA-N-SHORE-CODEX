/**
 * Round 14 (2.4): a nonce-based Content Security Policy, sent as Report-Only. Nothing is blocked;
 * browsers report what an enforced policy would block to /api/security/csp-report, and the policy
 * is enforced only after a clean week of reports.
 *
 * Next.js reads the nonce from this request header (enforcing or report-only) and stamps it on
 * its own scripts when the page renders dynamically.
 */
export const CSP_REPORT_PATH = '/api/security/csp-report'

export function createCspNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function reportOnlyContentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // Tailwind and component style attributes are inline; styles cannot run code.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    "media-src 'self' blob: https:",
    "frame-src 'self' https:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https:",
    "frame-ancestors 'none'",
    `report-uri ${CSP_REPORT_PATH}`,
  ].join('; ')
}

/** Only full page loads need the policy (and the nonce); API calls, assets and RSC data do not. */
export function wantsContentSecurityPolicy(request: { method: string; headers: Pick<Headers, 'get'>; nextUrl: { pathname: string } }): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  if (request.nextUrl.pathname.startsWith('/api/')) return false
  if (request.headers.get('rsc') || request.headers.get('next-router-prefetch')) return false
  const destination = request.headers.get('sec-fetch-dest')
  if (destination) return destination === 'document'
  return (request.headers.get('accept') ?? '').includes('text/html')
}
