// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getMediaObject: vi.fn() }))
vi.mock('@/lib/aws/storage', () => ({ getMediaObject: mocks.getMediaObject, createMediaReadUrl: vi.fn() }))

import { MEDIA_IMAGE_MAX_BYTES, createMediaImageLink } from '@/lib/images/media-image-link'
import { GET } from './route'

const KEY = 'profiles/11111111-1111-4111-8111-111111111111/avatar-abc.webp'
const previous = process.env.REALTIME_TICKET_SECRET

function request(link: string) {
  const url = new URL(link, 'https://seanshore.in')
  const key = url.pathname.replace('/api/media/image/', '').split('/')
  return [new Request(url), { params: Promise.resolve({ key }) }] as const
}

describe('GET /api/media/image/[...key]', () => {
  beforeAll(() => { process.env.REALTIME_TICKET_SECRET = 's'.repeat(48) })
  afterAll(() => { process.env.REALTIME_TICKET_SECRET = previous })
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getMediaObject.mockResolvedValue({ body: new Uint8Array([1, 2, 3]), contentType: 'image/webp', contentLength: 3 })
  })

  it('serves a photo behind a valid stable link, without a session, bounded in size', async () => {
    const link = createMediaImageLink(KEY) ?? ''
    const response = await GET(...request(link))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/webp')
    expect(response.headers.get('cache-control')).toBe('private, max-age=86400')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toContain('sandbox')
    expect(mocks.getMediaObject).toHaveBeenCalledWith({ key: KEY, maxBytes: MEDIA_IMAGE_MAX_BYTES })
    expect(MEDIA_IMAGE_MAX_BYTES).toBe(15 * 1024 * 1024)
  })

  it('refuses a missing, forged or other-key signature without reading storage', async () => {
    const link = createMediaImageLink(KEY) ?? ''
    for (const bad of [
      link.replace(/&s=[^&]+/, ''),
      link.replace(/&s=./, '&s=' + (link.match(/&s=(.)/)?.[1] === 'A' ? 'B' : 'A')),
      link.replace('avatar-abc', 'avatar-xyz'),
      link.replace(/w=\d+/, 'w=1'),
    ]) {
      const response = await GET(...request(bad))
      expect(response.status, bad).toBe(404)
    }
    expect(mocks.getMediaObject).not.toHaveBeenCalled()
  })

  it('never serves non-photo keys even with a signature for them', async () => {
    const response = await GET(...request('/api/media/image/messages/a/b/c.jpg?w=1&s=x'))
    expect(response.status).toBe(404)
    expect(mocks.getMediaObject).not.toHaveBeenCalled()
  })

  it('refuses non-raster content and storage failures', async () => {
    const link = createMediaImageLink(KEY) ?? ''
    mocks.getMediaObject.mockResolvedValueOnce({ body: new Uint8Array([60]), contentType: 'image/svg+xml', contentLength: 1 })
    expect((await GET(...request(link))).status).toBe(404)
    mocks.getMediaObject.mockRejectedValueOnce(new Error('media_object_too_large'))
    expect((await GET(...request(link))).status).toBe(404)
  })

  it('answers 503 when link signing is not configured', async () => {
    const link = createMediaImageLink(KEY) ?? ''
    process.env.REALTIME_TICKET_SECRET = ''
    try {
      expect((await GET(...request(link))).status).toBe(503)
    } finally {
      process.env.REALTIME_TICKET_SECRET = 's'.repeat(48)
    }
  })
})
