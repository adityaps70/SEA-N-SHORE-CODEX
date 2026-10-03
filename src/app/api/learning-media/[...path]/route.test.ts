import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getVerifiedUser, getMediaObject } = vi.hoisted(() => ({
  getVerifiedUser: vi.fn(),
  getMediaObject: vi.fn(),
}))

vi.mock('@/features/auth/queries', () => ({ getVerifiedUser }))
vi.mock('@/lib/aws/storage', () => ({ getMediaObject }))

const userId = '11111111-1111-4111-8111-111111111111'
const courseId = '22222222-2222-4222-8222-222222222222'
const objectId = '33333333-3333-4333-8333-333333333333'
const path = ['learning', userId, courseId, 'course_thumbnail', `${objectId}.webp`]

async function loadRoute() {
  return import('./route')
}

describe('GET /api/learning-media/[...path]', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    getVerifiedUser.mockResolvedValue({ id: userId, email: 'captain@example.com' })
    getMediaObject.mockResolvedValue({
      body: new TextEncoder().encode('image-bytes'),
      contentType: 'image/webp',
      contentLength: 11,
    })
  })

  it('requires an authenticated member before reading a course thumbnail', async () => {
    getVerifiedUser.mockResolvedValueOnce(null)
    const { GET } = await loadRoute()

    const response = await GET(
      new Request(`https://seaandshore.example/api/learning-media/${path.join('/')}`),
      { params: Promise.resolve({ path }) },
    )

    expect(response.status).toBe(401)
    expect(getMediaObject).not.toHaveBeenCalled()
  })

  it('rejects non-thumbnail learning objects and malformed keys', async () => {
    const { GET } = await loadRoute()
    const unsafePath = ['learning', userId, courseId, 'course_trailer', `${objectId}.mp4`]

    const response = await GET(
      new Request(`https://seaandshore.example/api/learning-media/${unsafePath.join('/')}`),
      { params: Promise.resolve({ path: unsafePath }) },
    )

    expect(response.status).toBe(404)
    expect(getMediaObject).not.toHaveBeenCalled()
  })

  it('serves canonical course thumbnails through the same-origin private route', async () => {
    const { GET } = await loadRoute()

    const response = await GET(
      new Request(`https://seaandshore.example/api/learning-media/${path.join('/')}`),
      { params: Promise.resolve({ path }) },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/webp')
    expect(response.headers.get('content-length')).toBe('11')
    expect(response.headers.get('cache-control')).toContain('private')
    expect(getMediaObject).toHaveBeenCalledWith({
      key: path.join('/'),
      maxBytes: 5 * 1024 * 1024,
    })
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe('image-bytes')
  })

  it('returns 404 when the private object cannot be read', async () => {
    getMediaObject.mockRejectedValueOnce(new Error('NoSuchKey'))
    const { GET } = await loadRoute()

    const response = await GET(
      new Request(`https://seaandshore.example/api/learning-media/${path.join('/')}`),
      { params: Promise.resolve({ path }) },
    )

    expect(response.status).toBe(404)
  })
})
