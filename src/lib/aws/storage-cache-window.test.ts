// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * Real SigV4 signing with static fake credentials and a mocked clock: proves that read URLs are
 * byte-identical inside one clock hour, change across hours, carry the cache header, and stay
 * valid for at least an hour even when signed at the very end of a window.
 */
const ENV_KEYS = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
  'AWS_REGION',
  'AWS_MEDIA_BUCKET',
] as const
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}

function signedExpiry(url: string) {
  const params = new URL(url).searchParams
  const date = params.get('X-Amz-Date')
  const expires = params.get('X-Amz-Expires')
  if (!date || !expires) throw new Error(`unsigned url: ${url}`)
  const iso = date.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z')
  return { signedAt: new Date(iso), expiresAt: new Date(new Date(iso).getTime() + Number(expires) * 1000) }
}

describe('windowed media read URL signing', () => {
  beforeAll(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
    process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE'
    process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
    delete process.env.AWS_SESSION_TOKEN
    delete process.env.AWS_PROFILE
    process.env.AWS_REGION = 'ap-south-1'
    process.env.AWS_MEDIA_BUCKET = 'sea-n-shore-staging-310356785722-media'
    vi.useFakeTimers({ toFake: ['Date'] })
  })

  afterAll(() => {
    vi.useRealTimers()
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
  })

  it('gives the byte-identical URL for the same key inside one clock hour', async () => {
    const { createMediaReadUrl } = await import('./storage')
    vi.setSystemTime(new Date('2026-09-29T10:03:00.000Z'))
    const first = await createMediaReadUrl('profiles/member/avatar.webp')
    vi.setSystemTime(new Date('2026-09-29T10:58:30.000Z'))
    const second = await createMediaReadUrl('profiles/member/avatar.webp')

    expect(second).toBe(first)
    expect(new URL(first).hostname).toBe('sea-n-shore-staging-310356785722-media.s3.ap-south-1.amazonaws.com')
    expect(new URL(first).searchParams.get('X-Amz-Date')).toBe('20260929T100000Z')
  })

  it('changes the URL once the clock moves into the next hour', async () => {
    const { createMediaReadUrl } = await import('./storage')
    vi.setSystemTime(new Date('2026-09-29T10:58:30.000Z'))
    const before = await createMediaReadUrl('profiles/member/avatar.webp')
    vi.setSystemTime(new Date('2026-09-29T11:00:01.000Z'))
    const after = await createMediaReadUrl('profiles/member/avatar.webp')

    expect(after).not.toBe(before)
    expect(new URL(after).searchParams.get('X-Amz-Date')).toBe('20260929T110000Z')
  })

  it('asks S3 to answer with a one-hour private cache header', async () => {
    const { createMediaReadUrl } = await import('./storage')
    vi.setSystemTime(new Date('2026-09-29T10:03:00.000Z'))
    const url = await createMediaReadUrl('profiles/member/avatar.webp')

    expect(new URL(url).searchParams.get('response-cache-control')).toBe('private, max-age=3600')
  })

  it('stays valid for at least an hour when signed at the end of a window', async () => {
    const { createMediaReadUrl } = await import('./storage')
    const now = new Date('2026-09-29T10:59:59.000Z')
    vi.setSystemTime(now)
    const url = await createMediaReadUrl('profiles/member/avatar.webp')
    const { signedAt, expiresAt } = signedExpiry(url)

    expect(signedAt.toISOString()).toBe('2026-09-29T10:00:00.000Z')
    expect(expiresAt.getTime() - now.getTime()).toBeGreaterThanOrEqual(3600 * 1000)
  })

  it('keeps sub-hour reads signed for this request only', async () => {
    const { createMediaReadUrl } = await import('./storage')
    vi.setSystemTime(new Date('2026-09-29T10:03:00.000Z'))
    const first = await createMediaReadUrl('profiles/member/avatar.webp', 600)
    vi.setSystemTime(new Date('2026-09-29T10:03:01.000Z'))
    const second = await createMediaReadUrl('profiles/member/avatar.webp', 600)

    expect(second).not.toBe(first)
    expect(new URL(first).searchParams.get('X-Amz-Expires')).toBe('600')
  })

  it('windows inline download URLs on request and leaves plain downloads per request', async () => {
    const { createMediaDownloadUrl } = await import('./storage')
    const input = {
      key: 'messages/a/b/c.jpg',
      contentType: 'image/jpeg',
      contentDisposition: 'inline; filename="c.jpg"',
    }
    vi.setSystemTime(new Date('2026-09-29T10:03:00.000Z'))
    const windowedFirst = await createMediaDownloadUrl({ ...input, cacheWindow: true })
    const plainFirst = await createMediaDownloadUrl(input)
    vi.setSystemTime(new Date('2026-09-29T10:40:00.000Z'))
    const windowedSecond = await createMediaDownloadUrl({ ...input, cacheWindow: true })
    const plainSecond = await createMediaDownloadUrl(input)

    expect(windowedSecond).toBe(windowedFirst)
    expect(new URL(windowedFirst).searchParams.get('response-cache-control')).toBe('private, max-age=3600')
    expect(plainSecond).not.toBe(plainFirst)
    expect(new URL(plainFirst).searchParams.get('X-Amz-Expires')).toBe('300')
    expect(new URL(plainFirst).searchParams.get('response-cache-control')).toBe('private, max-age=300')
  })
})
