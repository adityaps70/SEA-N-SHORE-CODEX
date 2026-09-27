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

const companyId = '22222222-2222-4222-8222-222222222222'
const context = (id = companyId) => ({ params: Promise.resolve({ companyId: id }) })

describe('GET /api/company-cover/[companyId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getVerifiedUser.mockResolvedValue({ id: 'user-1' })
    mocks.query.mockResolvedValue([{ cover_path: 'organizations/c1/cover-abc.jpg' }])
    mocks.getMediaObject.mockResolvedValue({ body: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg', contentLength: 3 })
  })

  it('requires a signed-in member', async () => {
    mocks.getVerifiedUser.mockResolvedValue(null)
    const response = await GET(new Request('https://example.test'), context())
    expect(response.status).toBe(401)
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('streams the stored cover image with a private cache header', async () => {
    const response = await GET(new Request('https://example.test'), context())
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get('cache-control')).toBe('private, max-age=3600')
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('select cover_path from public.companies'), [companyId])
    expect(mocks.getMediaObject).toHaveBeenCalledWith({ key: 'organizations/c1/cover-abc.jpg', maxBytes: 5 * 1024 * 1024 })
  })

  it('returns 404 for invalid ids, missing covers and non-image objects', async () => {
    expect((await GET(new Request('https://example.test'), context('not-a-uuid'))).status).toBe(404)

    mocks.query.mockResolvedValueOnce([{ cover_path: null }])
    expect((await GET(new Request('https://example.test'), context())).status).toBe(404)

    mocks.getMediaObject.mockResolvedValueOnce({ body: new Uint8Array([1]), contentType: 'text/html', contentLength: 1 })
    expect((await GET(new Request('https://example.test'), context())).status).toBe(404)
  })
})
