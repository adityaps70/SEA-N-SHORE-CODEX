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
    // Signed media-bucket URLs are resized to WebP/AVIF by the optimizer (see MediaImage). The
    // signed URL is stable for an hour, so optimized results are cached for at least that long.
    remotePatterns: OPTIMIZED_MEDIA_IMAGE_HOSTNAMES.map((hostname) => ({
      protocol: 'https' as const,
      hostname,
      pathname: '/**',
    })),
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 3600,
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default nextConfig
