import { randomBytes } from 'node:crypto'
import type { NextConfig } from 'next'
import { getServerActionAllowedOrigins } from './src/lib/auth/server-action-origins'

const securityHeaders = [
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Round 14 (2.4): HTTPS only for two years, subdomains included (preload-eligible).
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // Round H (H4): pages keep their browsing context to themselves, but windows they open stay
  // linked. Google sign-in is a full-page redirect (fine with plain same-origin); Cashfree's
  // `_modal` checkout and Razorpay Checkout may open pop-ups for UPI, wallet and bank steps and
  // report back through window.opener, which same-origin would cut. Ignored inside iframes, so the
  // SCORM player frame is unaffected.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
]

// Round ARCH (Phase 5 follow-up): one identifier per build, inlined into the client bundle. A tab still running an
// old build keys its one automatic reload on it (src/features/app-update/stale-deployment.ts).
const APP_BUILD_ID = process.env.NEXT_PUBLIC_APP_BUILD_ID || `build-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_APP_BUILD_ID: APP_BUILD_ID },
  reactStrictMode: true,
  // Round H (H4): do not advertise the framework (`x-powered-by: Next.js`).
  poweredByHeader: false,
  experimental: {
    // Round 13: bound the native (libvips) memory the image optimizer can take in the web task.
    // One image at a time, no libvips operation cache, streaming reads, and at most 50 MP per
    // source (the default 268 MP lets one decode allocate over a gigabyte).
    imgOptConcurrency: 1,
    imgOptOperationCache: false,
    imgOptSequentialRead: true,
    imgOptMaxInputPixels: 50_000_000,
    serverActions: {
      bodySizeLimit: '6mb',
      allowedOrigins: getServerActionAllowedOrigins(
        process.env.NEXT_PUBLIC_SITE_URL,
        process.env.SERVER_ACTION_ALLOWED_ORIGINS,
      ),
    },
  },
  images: {
    // Member photos, covers, logos and banners reach the optimizer through stable signed links
    // (/api/media/image/..., see media-image-link.ts) that stay the same for a 30-day window, so
    // each photo is resized once per size instead of again every clock hour when a pre-signed S3
    // URL used to change (Round 13: hourly memory spikes and OOM kills). Pre-signed S3 URLs are no
    // longer optimized at all. Landing photos are static files.
    // WebP only: Next encodes AVIF at quality × 50/80, which smears the text, logos and graphics
    // most images are made of. Quality 90 is for covers and banners, 75 for avatars; Next 16
    // snaps any quality not listed here to the nearest listed one.
    localPatterns: [
      { pathname: '/api/media/image/**' },
      { pathname: '/landing/**', search: '' },
    ],
    formats: ['image/webp'],
    qualities: [75, 90],
    minimumCacheTTL: 7 * 24 * 60 * 60,
    // Bounds what one decode can take (largest photo the media route serves is 15 MB) and the
    // optimizer's disk cache on the task's ephemeral storage.
    maximumResponseBody: 15 * 1024 * 1024,
    maximumDiskCacheSize: 2 * 1024 * 1024 * 1024,
  },
  async redirects() {
    // Round E (E7): people type /learn/my; the page is /learn/my-learning. A 301, as asked for.
    return [{ source: '/learn/my', destination: '/learn/my-learning', statusCode: 301 }]
  },
  async headers() {
    // Round 14 (3.1): public brand and landing images are not content-hashed, so the browser and
    // CloudFront keep them for a day and refresh them in the background for a week after that.
    const publicAssetCache = [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }]
    return [
      { source: '/(.*)', headers: securityHeaders },
      { source: '/brand/:path*', headers: publicAssetCache },
      { source: '/landing/:path*', headers: publicAssetCache },
      { source: '/favicon.ico', headers: publicAssetCache },
    ]
  },
}

export default nextConfig
