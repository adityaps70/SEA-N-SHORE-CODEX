import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getVerifiedUser, getMediaObject } = vi.hoisted(() => ({
  getVerifiedUser: vi.fn(),
  getMediaObject: vi.fn(),
}))

vi.mock('@/features/auth/queries', () => ({ getVerifiedUser }))
vi.mock('@/lib/aws/storage', () => ({ getMediaObject }))

const profileId = '11111111-1111-4111-8111-111111111111'
const postId = '22222222-2222-4222-8222-222222222222'
const objectId = '33333333-3333-4333-8333-333333333333'
const path = [profileId, postId, `${objectId}.mp4`]

async function loadRoute() {
  return import('./route')
}

describe('GET /api/feed-media/[...path]', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    getVerifiedUser.mockResolvedValue({ id: profileId, email: 'captain@example.com' })
    getMediaObject.mockResolvedValue({
      body: new TextEncoder().encode('video-bytes'),
      contentType: 'video/mp4',
      contentLength: 11,
    })
  })

  it('requires an authenticated member before reading private media', async () => {
    getVerifiedUser.mockResolvedValueOnce(null)
    const { GET } = await loadRoute()

    const response = await GET(
      new Request(`https://seaandshore.example/api/feed-media/${path.join('/')}`),
      { params: Promise.resolve({ path }) },
    )

    expect(response.status).toBe(401)
    expect(getMediaObject).not.toHaveBeenCalled()
  })

  it('rejects non-canonical media keys without touching S3', async () => {
    const { GET } = await loadRoute()
    const unsafePath = [profileId, '..', 'secret.mp4']

    const response = await GET(
      new Request(`https://seaandshore.example/api/feed-media/${unsafePath.join('/')}`),
      { params: Promise.resolve({ path: unsafePath }) },
    )

    expect(response.status).toBe(404)
    expect(getMediaObject).not.toHaveBeenCalled()
  })

  it('serves canonical private feed media from the same-origin route', async () => {
    const { GET } = await loadRoute()

    const response = await GET(
      new Request(`https://seaandshore.example/api/feed-media/${path.join('/')}`),
      { params: Promise.resolve({ path }) },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(response.headers.get('content-length')).toBe('11')
    expect(response.headers.get('cache-control')).toContain('private')
    expect(getMediaObject).toHaveBeenCalledWith({
      key: path.join('/'),
      maxBytes: 200 * 1024 * 1024,
    })
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe('video-bytes')
  })

  it('serves canonical PDF media inline for the document carousel', async () => {
    const { GET } = await loadRoute()
    const pdfPath = [profileId, postId, `${objectId}.pdf`]
    getMediaObject.mockResolvedValueOnce({
      body: new TextEncoder().encode('%PDF-test'),
      contentType: 'application/pdf',
      contentLength: 9,
    })

    const response = await GET(
      new Request(`https://seaandshore.example/api/feed-media/${pdfPath.join('/')}`),
      { params: Promise.resolve({ path: pdfPath }) },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toBe('inline')
    expect(getMediaObject).toHaveBeenCalledWith({
      key: pdfPath.join('/'),
      maxBytes: 200 * 1024 * 1024,
    })
  })

  it('returns 404 when the private object cannot be read', async () => {
    getMediaObject.mockRejectedValueOnce(new Error('NoSuchKey'))
    const { GET } = await loadRoute()

    const response = await GET(
      new Request(`https://seaandshore.example/api/feed-media/${path.join('/')}`),
      { params: Promise.resolve({ path }) },
    )

    expect(response.status).toBe(404)
  })
})
