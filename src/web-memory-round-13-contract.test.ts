import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

// Round 13: the single web task was OOM-killed roughly hourly. These keep the fixes in place.
describe('web memory contract (Round 13)', () => {
  const dockerfile = fs.readFileSync('Dockerfile', 'utf8')
  const nextConfig = fs.readFileSync('next.config.ts', 'utf8')
  const mediaSource = fs.readFileSync('src/lib/images/media-image-source.ts', 'utf8')

  it('runs Node directly with jemalloc and a bounded JS heap', () => {
    expect(dockerfile).toMatch(/CMD \["node", "node_modules\/next\/dist\/bin\/next", "start", "--keepAliveTimeout", "65000"\]/)
    expect(dockerfile).not.toMatch(/CMD \["npm"/)
    expect(dockerfile).toMatch(/apt-get install -y --no-install-recommends libjemalloc2/)
    expect(dockerfile).toMatch(/test -f \/usr\/lib\/x86_64-linux-gnu\/libjemalloc\.so\.2/)
    expect(dockerfile).toMatch(/ENV LD_PRELOAD=\/usr\/lib\/x86_64-linux-gnu\/libjemalloc\.so\.2/)
    expect(dockerfile).toMatch(/ENV NODE_OPTIONS=--max-old-space-size=1228/)
  })

  it('bounds the image optimizer: one image at a time, no op cache, 50 MP and 15 MB sources', () => {
    expect(nextConfig).toMatch(/imgOptConcurrency: 1,/)
    expect(nextConfig).toMatch(/imgOptOperationCache: false,/)
    expect(nextConfig).toMatch(/imgOptSequentialRead: true,/)
    expect(nextConfig).toMatch(/imgOptMaxInputPixels: 50_000_000,/)
    expect(nextConfig).toMatch(/maximumResponseBody: 15 \* 1024 \* 1024,/)
    expect(nextConfig).toMatch(/maximumDiskCacheSize: 2 \* 1024 \* 1024 \* 1024,/)
    expect(nextConfig).toMatch(/formats: \['image\/webp'\]/)
    expect(nextConfig).toMatch(/qualities: \[75, 90\]/)
  })

  it('optimizes only stable links, never hourly pre-signed S3 URLs', () => {
    expect(nextConfig).not.toMatch(/remotePatterns/)
    expect(nextConfig).toMatch(/\{ pathname: '\/api\/media\/image\/\*\*' \}/)
    expect(nextConfig).toMatch(/\{ pathname: '\/landing\/\*\*', search: '' \}/)
    expect(mediaSource).not.toMatch(/amazonaws\.com/)
  })

  it('signs photo srcs with the stable link helper wherever avatars, covers and banners are produced', () => {
    for (const file of [
      'src/features/profiles/aws-queries.ts',
      'src/features/messaging/queries.ts',
      'src/features/admin/avatars.ts',
      'src/features/jobs/applicant-media.ts',
      'src/features/events/event-banner-media.ts',
      'src/features/feed/media.ts',
      'src/app/(app)/community/[slug]/page.tsx',
      'src/app/(app)/organizations/[slug]/page.tsx',
    ]) {
      const source = fs.readFileSync(file, 'utf8')
      expect(source, file).toContain('createMediaImageSrc')
      expect(source, file).not.toMatch(/createMediaReadUrl\(/)
    }
  })
})
