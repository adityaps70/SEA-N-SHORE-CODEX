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

const COMPANY = '11111111-1111-4111-8111-111111111111'
const get = (id = COMPANY) => GET(new Request(`https://seanshore.in/api/company-logo/${id}`), { params: Promise.resolve({ companyId: id }) })

describe('GET /api/company-logo/[companyId] (Round H, H5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getMediaObject.mockResolvedValue({ body: new Uint8Array([1, 2, 3]), contentType: 'image/png', contentLength: 3 })
  })

  it('serves a verified organization\'s logo to signed-out visitors and search engines, publicly cacheable', async () => {
    mocks.getVerifiedUser.mockResolvedValue(null)
    mocks.query.mockResolvedValue([{ logo_path: 'companies/logo.png', is_verified: true }])
    const response = await get()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600')
  })

  it('keeps other organizations\' logos for signed-in members', async () => {
    mocks.getVerifiedUser.mockResolvedValue(null)
    mocks.query.mockResolvedValue([{ logo_path: 'companies/logo.png', is_verified: false }])
    expect((await get()).status).toBe(401)
    expect(mocks.getMediaObject).not.toHaveBeenCalled()

    mocks.getVerifiedUser.mockResolvedValue({ id: 'viewer' })
    const response = await get()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, max-age=3600')
  })

  it('refuses malformed ids without a query', async () => {
    mocks.getVerifiedUser.mockResolvedValue(null)
    expect((await get('not-a-uuid')).status).toBe(401)
    expect(mocks.query).not.toHaveBeenCalled()
  })
})
