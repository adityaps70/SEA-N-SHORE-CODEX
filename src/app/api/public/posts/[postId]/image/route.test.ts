import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getPublicPostImagePath, getMediaObject } = vi.hoisted(() => ({
  getPublicPostImagePath: vi.fn(),
  getMediaObject: vi.fn(),
}))

vi.mock('@/features/feed/repository', () => ({ feedRepository: { getPublicPostImagePath } }))
vi.mock('@/features/feed/queries', () => ({ isPostId: (value: string) => /^[0-9a-f-]{36}$/.test(value) }))
vi.mock('@/lib/aws/storage', () => ({ getMediaObject }))

const postId = '22222222-2222-4222-8222-222222222222'

async function get(id: string, ip = '203.0.113.7') {
  const { GET } = await import('./route')
  return GET(new Request(`https://seanshore.example/api/public/posts/${id}/image`, { headers: { 'x-forwarded-for': `${ip}, 198.51.100.1` } }), { params: Promise.resolve({ postId: id }) })
}

describe('GET /api/public/posts/[postId]/image (round F share card)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    getPublicPostImagePath.mockResolvedValue('posts/fixture/one.jpg')
    getMediaObject.mockResolvedValue({ body: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg', contentLength: 3 })
  })

  it('serves the first photo of an "Anyone" post, publicly cacheable for a short time', async () => {
    const response = await get(postId)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get('cache-control')).toBe('public, max-age=300')
    expect(getPublicPostImagePath).toHaveBeenCalledWith(postId)
  })

  it('is a 404 for any other post, a post without a photo, or a malformed id', async () => {
    getPublicPostImagePath.mockResolvedValueOnce(null)
    expect((await get(postId)).status).toBe(404)
    expect((await get('not-a-post')).status).toBe(404)
    expect(getMediaObject).not.toHaveBeenCalled()
  })

  it('never serves anything but a photo', async () => {
    getMediaObject.mockResolvedValueOnce({ body: new Uint8Array([1]), contentType: 'application/pdf', contentLength: 1 })
    expect((await get(postId)).status).toBe(404)
  })

  it('limits requests per visitor address', async () => {
    const { GET } = await import('./route')
    const request = () => GET(new Request(`https://seanshore.example/api/public/posts/${postId}/image`, { headers: { 'x-forwarded-for': '203.0.113.99, 198.51.100.1' } }), { params: Promise.resolve({ postId }) })
    const statuses: number[] = []
    for (let index = 0; index < 61; index += 1) statuses.push((await request()).status)
    expect(statuses.slice(0, 60).every((status) => status === 200)).toBe(true)
    expect(statuses[60]).toBe(429)
  })
})
