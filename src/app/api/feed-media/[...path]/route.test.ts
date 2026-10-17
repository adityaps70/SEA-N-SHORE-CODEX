import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getVerifiedUser, getMediaObject, createMediaDownloadUrl, headMediaObject, streamMediaObject, canUsePlatformAdminAuthority, isPostVisibleTo, isPostPublic } = vi.hoisted(() => ({
  getVerifiedUser: vi.fn(),
  getMediaObject: vi.fn(),
  createMediaDownloadUrl: vi.fn(),
  headMediaObject: vi.fn(),
  streamMediaObject: vi.fn(),
  canUsePlatformAdminAuthority: vi.fn(),
  isPostVisibleTo: vi.fn(),
  isPostPublic: vi.fn(),
}))

vi.mock('@/features/auth/queries', () => ({ getVerifiedUser }))
vi.mock('@/features/admin/mfa-gate', () => ({ canUsePlatformAdminAuthority }))
vi.mock('@/lib/aws/storage', () => ({ getMediaObject, createMediaDownloadUrl, headMediaObject, streamMediaObject }))
vi.mock('@/features/feed/repository', () => ({ feedRepository: { isPostVisibleTo, isPostPublic } }))

const viewerId = '44444444-4444-4444-8444-444444444444'
const profileId = '11111111-1111-4111-8111-111111111111'
const postId = '22222222-2222-4222-8222-222222222222'
const objectId = '33333333-3333-4333-8333-333333333333'
const path = [profileId, postId, `${objectId}.mp4`]

async function get(parts: string[], query = '', headers: Record<string, string> = {}) {
  const { GET } = await import('./route')
  return GET(new Request(`https://seaandshore.example/api/feed-media/${parts.join('/')}${query}`, { headers }), { params: Promise.resolve({ path: parts }) })
}

describe('GET /api/feed-media/[...path]', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    getVerifiedUser.mockResolvedValue({ id: viewerId, email: 'captain@example.com' })
    isPostVisibleTo.mockResolvedValue(true)
    isPostPublic.mockResolvedValue(false)
    createMediaDownloadUrl.mockResolvedValue('https://media.s3.example/signed-video')
    getMediaObject.mockResolvedValue({ body: new TextEncoder().encode('%PDF-test'), contentType: 'application/pdf', contentLength: 9 })
  })

  it('requires an authenticated member before reading media of a members-only post', async () => {
    getVerifiedUser.mockResolvedValueOnce(null)
    const response = await get(path)
    expect(response.status).toBe(401)
    expect(isPostVisibleTo).not.toHaveBeenCalled()
    expect(isPostPublic).toHaveBeenCalledWith(postId, profileId)
    expect(createMediaDownloadUrl).not.toHaveBeenCalled()
  })

  it('serves a signed-out visitor the media of a post its author shows to anyone (round F)', async () => {
    getVerifiedUser.mockResolvedValueOnce(null)
    isPostPublic.mockResolvedValueOnce(true)
    const response = await get(path)
    expect(response.status).toBe(302)
    expect(isPostVisibleTo).not.toHaveBeenCalled()
    expect(createMediaDownloadUrl).toHaveBeenCalledTimes(1)
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

  describe('video posters (Round H, H1)', () => {
    const posterPath = [profileId, postId, `${objectId}.poster.jpg`]

    it('redirects to a stored poster with the same visibility rules as the video', async () => {
      headMediaObject.mockResolvedValueOnce({ contentType: 'image/jpeg', contentLength: 2000 })
      const response = await get(posterPath)
      expect(response.status).toBe(302)
      expect(isPostVisibleTo).toHaveBeenCalledWith(viewerId, postId, profileId)
      expect(createMediaDownloadUrl).toHaveBeenCalledWith(expect.objectContaining({ key: posterPath.join('/'), contentType: 'image/jpeg' }))
    })

    it('answers 404 for a video that has no poster yet, without a redirect to a missing object', async () => {
      headMediaObject.mockRejectedValueOnce(new Error('NotFound'))
      const response = await get(posterPath)
      expect(response.status).toBe(404)
      expect(createMediaDownloadUrl).not.toHaveBeenCalled()
    })

    it('hides the poster of a post the viewer cannot see', async () => {
      isPostVisibleTo.mockResolvedValueOnce(false)
      const response = await get(posterPath)
      expect(response.status).toBe(404)
      expect(headMediaObject).not.toHaveBeenCalled()
    })

    it('streams the video from this origin for the author, passing the Range through', async () => {
      getVerifiedUser.mockResolvedValueOnce({ id: profileId, email: 'author@example.com' })
      streamMediaObject.mockResolvedValueOnce({ body: new Blob(['abc']).stream(), status: 206, contentType: 'video/mp4', contentLength: 3, contentRange: 'bytes 0-2/10', acceptRanges: 'bytes' })
      const response = await get(path, '?source=poster', { range: 'bytes=0-2' })
      expect(response.status).toBe(206)
      expect(response.headers.get('content-range')).toBe('bytes 0-2/10')
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(streamMediaObject).toHaveBeenCalledWith({ key: path.join('/'), range: 'bytes=0-2' })
      expect(createMediaDownloadUrl).not.toHaveBeenCalled()
    })

    it('streams it for a platform administrator too', async () => {
      canUsePlatformAdminAuthority.mockResolvedValueOnce(true)
      streamMediaObject.mockResolvedValueOnce({ body: new Blob(['abc']).stream(), status: 200, contentType: 'video/mp4', contentLength: 3, contentRange: null, acceptRanges: 'bytes' })
      const response = await get(path, '?source=poster')
      expect(response.status).toBe(200)
      expect(canUsePlatformAdminAuthority).toHaveBeenCalledWith(viewerId)
    })

    it('never streams it for other members or signed-out visitors', async () => {
      canUsePlatformAdminAuthority.mockResolvedValueOnce(false)
      expect((await get(path, '?source=poster')).status).toBe(404)
      getVerifiedUser.mockResolvedValueOnce(null)
      isPostPublic.mockResolvedValueOnce(true)
      expect((await get(path, '?source=poster')).status).toBe(404)
      expect(streamMediaObject).not.toHaveBeenCalled()
    })
  })
})
