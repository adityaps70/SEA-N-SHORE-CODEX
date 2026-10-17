/**
 * Round 14 (2.4): a nonce-based Content Security Policy, sent as Report-Only. Nothing is blocked;
 * browsers report what an enforced policy would block to /api/security/csp-report, and the policy
 * is enforced only after a clean week of reports.
 *
 * Next.js reads the nonce from this request header (enforcing or report-only) and stamps it on
 * its own scripts when the page renders dynamically.
 */
export const CSP_REPORT_PATH = '/api/security/csp-report'

/**
 * Round H (H4): the one switch for enforcing. While false, every policy goes out as
 * Content-Security-Policy-Report-Only; flipping it (after a clean week of reports) enforces the
 * same policies as Content-Security-Policy.
 */
export const ENFORCE_CONTENT_SECURITY_POLICY = false

export const CONTENT_SECURITY_POLICY_HEADER = ENFORCE_CONTENT_SECURITY_POLICY
  ? 'Content-Security-Policy'
  : 'Content-Security-Policy-Report-Only'

export function createCspNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

// Round H (H4): the third-party hosts pages actually use, replacing the old blanket `https:`.
const GOOGLE_FONTS_STYLESHEETS = 'https://fonts.googleapis.com'
const GOOGLE_FONTS_FILES = 'https://fonts.gstatic.com'
// Cashfree JS SDK v3 (sdk.cashfree.com) opens its `_modal` checkout in an iframe and calls the
// Cashfree API (api., sandbox., payments.cashfree.com) from the page.
const CASHFREE_SDK = 'https://sdk.cashfree.com'
const CASHFREE_HOSTS = 'https://*.cashfree.com'
// Razorpay Checkout: its script, its checkout iframe, its API and its event logger.
const RAZORPAY_SCRIPT = 'https://checkout.razorpay.com'
const RAZORPAY_FRAMES = ['https://api.razorpay.com', 'https://checkout.razorpay.com']
const RAZORPAY_CONNECT = ['https://api.razorpay.com', 'https://lumberjack.razorpay.com']
// External lesson embeds (material-player.tsx builds only these two).
const VIDEO_EMBEDS = ['https://www.youtube-nocookie.com', 'https://player.vimeo.com']

// Used when the media bucket or the realtime endpoint is not configured (local runs, tests).
const FALLBACK_MEDIA_ORIGINS = ['https://*.s3.ap-south-1.amazonaws.com', 'https://*.s3.amazonaws.com']
const FALLBACK_REALTIME_ORIGINS = ['wss://*.execute-api.ap-south-1.amazonaws.com']

export type ContentSecurityPolicySources = {
  /** S3: browsers PUT uploads to pre-signed URLs and show or play pre-signed GETs (photos, video, lesson PDFs). */
  mediaOrigins: string[]
  /** The API Gateway WebSocket for realtime updates. */
  realtimeOrigins: string[]
  /** Cognito hosted UI: signing out without JavaScript is a form post that redirects there. */
  signInOrigins: string[]
  /** `next dev` needs eval (React's debugging) and its HMR WebSocket. */
  development: boolean
}

type Environment = Record<string, string | undefined>

function mediaBucketOrigin(environment: Environment): string | null {
  // The S3 client signs virtual-hosted URLs (<bucket>.s3.<region>.amazonaws.com) for DNS-safe
  // names without dots; anything else falls back to the S3 wildcards.
  const bucket = environment.AWS_MEDIA_BUCKET?.trim()
  if (!bucket || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) return null
  const region = (environment.AWS_REGION || environment.AWS_COGNITO_REGION || 'ap-south-1').trim()
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(region)) return null
  return `https://${bucket}.s3.${region}.amazonaws.com`
}

function realtimeOrigin(environment: Environment): string | null {
  try {
    const url = new URL(environment.REALTIME_WEBSOCKET_URL?.trim() ?? '')
    return url.protocol === 'wss:' ? url.origin : null
  } catch {
    return null
  }
}

function cognitoOrigin(environment: Environment): string | null {
  const domain = environment.AWS_COGNITO_DOMAIN?.trim().replace(/^https?:\/\//i, '').replace(/\/+$/g, '').toLowerCase()
  return domain && /^[a-z0-9.-]+$/.test(domain) ? `https://${domain}` : null
}

/** Round H (H4): exact hosts from the task's runtime environment, with safe fallbacks. */
export function contentSecurityPolicySources(environment: Environment = process.env): ContentSecurityPolicySources {
  const bucket = mediaBucketOrigin(environment)
  const realtime = realtimeOrigin(environment)
  const cognito = cognitoOrigin(environment)
  return {
    mediaOrigins: bucket ? [bucket] : FALLBACK_MEDIA_ORIGINS,
    realtimeOrigins: realtime ? [realtime] : FALLBACK_REALTIME_ORIGINS,
    signInOrigins: cognito ? [cognito] : [],
    development: environment.NODE_ENV === 'development',
  }
}

// The environment does not change while the server runs, so the sources are read once.
let runtimeSources: ContentSecurityPolicySources | null = null

function directive(name: string, ...sources: Array<string | string[]>): string {
  return [name, ...sources.flat()].join(' ')
}

/**
 * The policy for page loads. Round H (H4): tightened from blanket `https:` to the hosts the site
 * actually uses. Scripts still load only by nonce with 'strict-dynamic', which also trusts the
 * payment SDKs our own scripts insert; the script hosts listed are a CSP2 fallback that CSP3
 * browsers ignore when 'strict-dynamic' is present.
 */
export function pageContentSecurityPolicy(nonce: string, sources?: ContentSecurityPolicySources): string {
  const { mediaOrigins, realtimeOrigins, signInOrigins, development } = sources ?? (runtimeSources ??= contentSecurityPolicySources())
  return [
    "default-src 'self'",
    directive('script-src', "'self'", `'nonce-${nonce}'`, "'strict-dynamic'", development ? ["'unsafe-eval'"] : [], CASHFREE_SDK, RAZORPAY_SCRIPT),
    // Tailwind and component style attributes are inline; styles cannot run code. The landing page
    // loads the Google Fonts stylesheet.
    directive('style-src', "'self'", "'unsafe-inline'", GOOGLE_FONTS_STYLESHEETS),
    // data: and blob: cover inline icons and local previews of photos before they upload.
    directive('img-src', "'self'", 'data:', 'blob:', mediaOrigins),
    directive('font-src', "'self'", 'data:', GOOGLE_FONTS_FILES),
    directive('connect-src', "'self'", mediaOrigins, realtimeOrigins, CASHFREE_HOSTS, RAZORPAY_CONNECT, development ? ['ws:'] : []),
    // Feed videos redirect from /api/feed-media to S3; lesson audio and video are pre-signed S3
    // GETs; blob: plays local previews of videos before they upload.
    directive('media-src', "'self'", 'blob:', mediaOrigins),
    // SCORM packages (own origin), lesson PDFs (pre-signed S3), video embeds and payment checkouts.
    directive('frame-src', "'self'", mediaOrigins, VIDEO_EMBEDS, CASHFREE_HOSTS, RAZORPAY_FRAMES),
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    directive('form-action', "'self'", signInOrigins),
    "frame-ancestors 'none'",
    `report-uri ${CSP_REPORT_PATH}`,
  ].join('; ')
}

/**
 * Round H (H4): API responses (JSON, media, redirects) never render a page, so they carry a fixed
 * lock-everything-down policy without a nonce.
 */
export const API_CONTENT_SECURITY_POLICY = ["default-src 'none'", "frame-ancestors 'none'", `report-uri ${CSP_REPORT_PATH}`].join('; ')

/** Only full page loads need the policy (and the nonce); API calls, assets and RSC data do not. */
export function wantsContentSecurityPolicy(request: { method: string; headers: Pick<Headers, 'get'>; nextUrl: { pathname: string } }): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  if (request.nextUrl.pathname.startsWith('/api/')) return false
  if (request.headers.get('rsc') || request.headers.get('next-router-prefetch')) return false
  const destination = request.headers.get('sec-fetch-dest')
  if (destination) return destination === 'document'
  return (request.headers.get('accept') ?? '').includes('text/html')
}

// Round H (H4): SCORM package files send their own enforced sandbox policy (SCORM_CONTENT_SANDBOX)
// and must keep running the package's inline scripts and styles, so they get nothing extra.
const SCORM_CONTENT_PATH = /^\/api\/learning\/scorm\/[^/]+\/content(?:\/|$)/

/** Round H (H4): API responses get API_CONTENT_SECURITY_POLICY, except SCORM package files. */
export function wantsApiContentSecurityPolicy(request: { nextUrl: { pathname: string } }): boolean {
  const { pathname } = request.nextUrl
  return pathname.startsWith('/api/') && !SCORM_CONTENT_PATH.test(pathname)
}
