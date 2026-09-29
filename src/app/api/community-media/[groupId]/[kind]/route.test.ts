import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getVerifiedUser: vi.fn(),
  query: vi.fn(),
  getMediaObject: vi.fn(),
}))

vi.mock('@/features/auth/queries', () => ({ getVerifiedUser: mocks.getVerifiedUser }))
vi.mock('@/lib/db/client', () => ({ query: mocks.query }))
vi.mock('@/lib/aws/storage', () => ({ getMediaObject: mocks.getMediaObject }))

import { GET } from './route'

const groupId = '22222222-2222-4222-8222-222222222222'
const context = (kind = 'cover', id = groupId) => ({ params: Promise.resolve({ groupId: id, kind }) })

describe('GET /api/community-media/[groupId]/[kind]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getVerifiedUser.mockResolvedValue({ id: 'user-1' })
    mocks.query.mockResolvedValue([{ cover_path: 'communities/g1/cover-abc.jpg', icon_path: 'communities/g1/icon-def.webp' }])
    mocks.getMediaObject.mockResolvedValue({ body: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg', contentLength: 3 })
  })

  it('requires a signed-in member', async () => {
    mocks.getVerifiedUser.mockResolvedValue(null)
    const response = await GET(new Request('https://example.test'), context())
    expect(response.status).toBe(401)
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('streams the stored banner with a private cache header', async () => {
    const response = await GET(new Request('https://example.test'), context('cover'))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get('cache-control')).toBe('private, max-age=3600')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('select cover_path, icon_path from public.community_groups'), [groupId])
    expect(mocks.getMediaObject).toHaveBeenCalledWith({ key: 'communities/g1/cover-abc.jpg', maxBytes: 5 * 1024 * 1024 })
  })

  it('streams the community photo from icon_path', async () => {
    mocks.getMediaObject.mockResolvedValueOnce({ body: new Uint8Array([1]), contentType: 'image/webp; charset=binary', contentLength: 1 })
    const response = await GET(new Request('https://example.test'), context('icon'))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/webp')
    expect(mocks.getMediaObject).toHaveBeenCalledWith({ key: 'communities/g1/icon-def.webp', maxBytes: 5 * 1024 * 1024 })
  })

  it('serves archived groups too (site admins look at them)', async () => {
    // The lookup does not filter on archived_at; the row is returned whatever its state.
    const response = await GET(new Request('https://example.test'), context('cover'))
    expect(response.status).toBe(200)
    expect(mocks.query.mock.calls[0]?.[0]).not.toContain('archived_at')
  })

  it('returns 404 for invalid ids, unknown kinds, missing images, oversized or non-image objects', async () => {
    expect((await GET(new Request('https://example.test'), context('cover', 'not-a-uuid'))).status).toBe(404)
    expect((await GET(new Request('https://example.test'), context('logo'))).status).toBe(404)
    expect(mocks.query).not.toHaveBeenCalled()

    mocks.query.mockResolvedValueOnce([{ cover_path: null, icon_path: 'communities/g1/icon.png' }])
    expect((await GET(new Request('https://example.test'), context('cover'))).status).toBe(404)
    expect(mocks.getMediaObject).not.toHaveBeenCalled()

    mocks.query.mockResolvedValueOnce([])
    expect((await GET(new Request('https://example.test'), context('icon'))).status).toBe(404)

    mocks.getMediaObject.mockResolvedValueOnce({ body: new Uint8Array([1]), contentType: 'text/html', contentLength: 1 })
    expect((await GET(new Request('https://example.test'), context('cover'))).status).toBe(404)

    mocks.getMediaObject.mockRejectedValueOnce(new Error('media_object_too_large'))
    expect((await GET(new Request('https://example.test'), context('cover'))).status).toBe(404)
  })
})
