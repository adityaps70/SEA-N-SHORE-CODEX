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
    serverActions: {
      bodySizeLimit: '6mb',
      allowedOrigins: getServerActionAllowedOrigins(process.env.NEXT_PUBLIC_SITE_URL),
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'sea-n-shore-staging-310356785722-media.s3.ap-south-1.amazonaws.com',
        pathname: '/**',
      },
    ],
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default nextConfig
