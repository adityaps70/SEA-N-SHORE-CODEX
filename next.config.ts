import type { NextConfig } from 'next'
import { getServerActionAllowedOrigins } from './src/lib/auth/server-action-origins'

const securityHeaders = [
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default nextConfig
