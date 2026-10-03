import { describe, expect, it } from 'vitest'
import nextConfig from '../next.config'

describe('Next.js server action upload envelope', () => {
  it('allows the 5 MiB composer image limit plus multipart form overhead', () => {
    const serverActions = nextConfig.experimental?.serverActions

    expect(serverActions).toMatchObject({
      bodySizeLimit: '6mb',
    })
  })

  // Rewritten in Round 13: hourly pre-signed S3 URLs are no longer optimized (that re-encoded
  // every photo each hour); only stable signed media links and landing photos are.
  it('optimizes stable signed media links and landing photos, never pre-signed S3 URLs', () => {
    expect(nextConfig.images?.remotePatterns).toBeUndefined()
    expect(nextConfig.images?.localPatterns).toEqual([
      { pathname: '/api/media/image/**' },
      { pathname: '/landing/**', search: '' },
    ])
  })

  it('serves resized WebP only (AVIF smears graphics) and keeps results for the stable link lifetime', () => {
    expect(nextConfig.images).toMatchObject({
      formats: ['image/webp'],
      minimumCacheTTL: 7 * 24 * 60 * 60,
    })
    expect(nextConfig.images?.formats).not.toContain('image/avif')
  })

  it('allows the sharp quality post images and covers ask for, next to the avatar default', () => {
    expect(nextConfig.images?.qualities).toEqual(expect.arrayContaining([75, 90]))
  })
})
