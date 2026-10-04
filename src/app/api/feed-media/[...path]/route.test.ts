import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getVerifiedUser, getMediaObject, createMediaDownloadUrl, isPostVisibleTo } = vi.hoisted(() => ({
  getVerifiedUser: vi.fn(),
  getMediaObject: vi.fn(),
  createMediaDownloadUrl: vi.fn(),
  isPostVisibleTo: vi.fn(),
}))

vi.mock('@/features/auth/queries', () => ({ getVerifiedUser }))
vi.mock('@/lib/aws/storage', () => ({ getMediaObject, createMediaDownloadUrl }))
vi.mock('@/features/feed/repository', () => ({ feedRepository: { isPostVisibleTo } }))

const viewerId = '44444444-4444-4444-8444-444444444444'
const profileId = '11111111-1111-4111-8111-111111111111'
const postId = '22222222-2222-4222-8222-222222222222'
const objectId = '33333333-3333-4333-8333-333333333333'
const path = [profileId, postId, `${objectId}.mp4`]

async function get(parts: string[]) {
  const { GET } = await import('./route')
  return GET(new Request(`https://seaandshore.example/api/feed-media/${parts.join('/')}`), { params: Promise.resolve({ path: parts }) })
}

describe('GET /api/feed-media/[...path]', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    getVerifiedUser.mockResolvedValue({ id: viewerId, email: 'captain@example.com' })
    isPostVisibleTo.mockResolvedValue(true)
    createMediaDownloadUrl.mockResolvedValue('https://media.s3.example/signed-video')
    getMediaObject.mockResolvedValue({ body: new TextEncoder().encode('%PDF-test'), contentType: 'application/pdf', contentLength: 9 })
  })

  it('requires an authenticated member before reading private media', async () => {
    getVerifiedUser.mockResolvedValueOnce(null)
    const response = await get(path)
    expect(response.status).toBe(401)
    expect(isPostVisibleTo).not.toHaveBeenCalled()
    expect(createMediaDownloadUrl).not.toHaveBeenCalled()
  })

  it('rejects non-canonical media keys without touching the database or S3', async () => {
    const response = await get([profileId, '..', 'secret.mp4'])
    expect(response.status).toBe(404)
    expect(isPostVisibleTo).not.toHaveBeenCalled()
    expect(createMediaDownloadUrl).not.toHaveBeenCalled()
  })

  it('hides media of posts the viewer cannot see (Round 14, 2.2)', async () => {
    isPostVisibleTo.mockResolvedValueOnce(false)
    const response = await get(path)
    expect(response.status).toBe(404)
    expect(isPostVisibleTo).toHaveBeenCalledWith(viewerId, postId, profileId)
    expect(createMediaDownloadUrl).not.toHaveBeenCalled()
    expect(getMediaObject).not.toHaveBeenCalled()
  })

  it('redirects visible photos and videos to an hour-stable signed URL instead of streaming them', async () => {
    const response = await get(path)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://media.s3.example/signed-video')
    expect(response.headers.get('cache-control')).toBe('private, max-age=1800')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(createMediaDownloadUrl).toHaveBeenCalledWith({ key: path.join('/'), contentType: 'video/mp4', contentDisposition: 'inline', cacheWindow: true })
    expect(getMediaObject).not.toHaveBeenCalled()
  })

  it('serves visible PDFs inline from this origin for the pdf.js carousel, bounded to the document limit', async () => {
    const pdfPath = [profileId, postId, `${objectId}.pdf`]
    const response = await get(pdfPath)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toBe('inline')
    expect(getMediaObject).toHaveBeenCalledWith({ key: pdfPath.join('/'), maxBytes: 25 * 1024 * 1024 })
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe('%PDF-test')
  })

  it('returns 404 when the object cannot be signed or read', async () => {
    createMediaDownloadUrl.mockRejectedValueOnce(new Error('no credentials'))
    expect((await get(path)).status).toBe(404)
    getMediaObject.mockRejectedValueOnce(new Error('NoSuchKey'))
    expect((await get([profileId, postId, `${objectId}.pdf`])).status).toBe(404)
  })
})
