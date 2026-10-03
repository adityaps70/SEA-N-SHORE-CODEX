import type { NextConfig } from 'next'
import { getServerActionAllowedOrigins } from './src/lib/auth/server-action-origins'
import { OPTIMIZED_MEDIA_IMAGE_HOSTNAMES } from './src/lib/images/media-image-source'

const securityHeaders = [
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '6mb',
      allowedOrigins: getServerActionAllowedOrigins(
        process.env.NEXT_PUBLIC_SITE_URL,
        process.env.SERVER_ACTION_ALLOWED_ORIGINS,
      ),
    },
  },
  images: {
    // Signed media-bucket URLs are resized to WebP by the optimizer (see MediaImage). The signed
    // URL is stable for an hour, so optimized results are cached for at least that long.
    // WebP only: Next encodes AVIF at quality × 50/80, which smears the text, logos and graphics
    // most post images are made of. Quality 90 is for post images and covers, 75 for avatars;
    // Next 16 snaps any quality not listed here to the nearest listed one.
    remotePatterns: OPTIMIZED_MEDIA_IMAGE_HOSTNAMES.map((hostname) => ({
      protocol: 'https' as const,
      hostname,
      pathname: '/**',
    })),
    formats: ['image/webp'],
    qualities: [75, 90],
    minimumCacheTTL: 3600,
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default nextConfig
