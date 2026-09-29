import { describe, expect, it } from 'vitest'
import nextConfig from '../next.config'

describe('Next.js server action upload envelope', () => {
  it('allows the 5 MiB composer image limit plus multipart form overhead', () => {
    const serverActions = nextConfig.experimental?.serverActions

    expect(serverActions).toMatchObject({
      bodySizeLimit: '6mb',
    })
  })

  it('allows signed reads from the private staging media bucket', () => {
    expect(nextConfig.images?.remotePatterns).toEqual(expect.arrayContaining([
      expect.objectContaining({
        protocol: 'https',
        hostname: 'sea-n-shore-staging-310356785722-media.s3.ap-south-1.amazonaws.com',
        pathname: '/**',
      }),
    ]))
  })

  it('serves resized WebP only (AVIF smears graphics) and keeps results cached for the signed URL window', () => {
    expect(nextConfig.images).toMatchObject({
      formats: ['image/webp'],
      minimumCacheTTL: 3600,
    })
    expect(nextConfig.images?.formats).not.toContain('image/avif')
  })

  it('allows the sharp quality post images and covers ask for, next to the avatar default', () => {
    expect(nextConfig.images?.qualities).toEqual(expect.arrayContaining([75, 90]))
  })
})
