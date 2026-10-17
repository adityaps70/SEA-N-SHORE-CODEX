import { describe, expect, it, vi } from 'vitest'
import { POST_VIDEO_POSTER_MAX_BYTES, parsePostVideoStoragePath, postVideoPosterStoragePath } from './media-policy'
import { posterSeekTime, posterSize, uploadVideoPoster } from './video-poster'

const PROFILE = '11111111-1111-4111-8111-111111111111'
const POST = '22222222-2222-4222-8222-222222222222'
const OBJECT = '33333333-3333-4333-8333-333333333333'

describe('video poster paths', () => {
  it('stores the poster next to the video, derived from its name', () => {
    expect(postVideoPosterStoragePath(`${PROFILE}/${POST}/${OBJECT}.mp4`)).toBe(`${PROFILE}/${POST}/${OBJECT}.poster.jpg`)
    expect(postVideoPosterStoragePath(`${PROFILE}/${POST}/${OBJECT}.webm`)).toBe(`${PROFILE}/${POST}/${OBJECT}.poster.jpg`)
  })

  it('refuses anything that is not a canonical video path', () => {
    expect(postVideoPosterStoragePath(`${PROFILE}/${POST}/${OBJECT}.jpg`)).toBeNull()
    expect(postVideoPosterStoragePath(`${PROFILE}/${POST}/../${OBJECT}.mp4`)).toBeNull()
    expect(postVideoPosterStoragePath(`profiles/${POST}/${OBJECT}.mp4`)).toBeNull()
    expect(parsePostVideoStoragePath(`${PROFILE}/${POST}/${OBJECT}.mp4`)).toEqual({ profileId: PROFILE, postId: POST, objectId: OBJECT })
  })
})

describe('poster capture maths', () => {
  it('takes a frame a tenth of the way in, at most 1 s', () => {
    expect(posterSeekTime(5)).toBe(0.5)
    expect(posterSeekTime(60)).toBe(1)
    expect(posterSeekTime(Number.NaN)).toBe(0)
  })

  it('scales down to 1280 px wide, never up', () => {
    expect(posterSize(1920, 1080)).toEqual({ width: 1280, height: 720 })
    expect(posterSize(640, 360)).toEqual({ width: 640, height: 360 })
    expect(posterSize(0, 0)).toBeNull()
  })
})

describe('uploadVideoPoster', () => {
  const videoStoragePath = `${PROFILE}/${POST}/${OBJECT}.mp4`

  it('captures, asks for a signed PUT with the exact size and uploads the JPEG', async () => {
    const poster = new Blob([new Uint8Array(1234)], { type: 'image/jpeg' })
    const createUpload = vi.fn(async () => ({ ok: true as const, uploadUrl: 'https://s3.example/put' }))
    const put = vi.fn(async () => new Response(null, { status: 200 }))
    const ok = await uploadVideoPoster({ videoStoragePath, source: 'blob:x', createUpload, capture: async () => poster, put })
    expect(ok).toBe(true)
    expect(createUpload).toHaveBeenCalledWith({ videoStoragePath, size: 1234 })
    expect(put).toHaveBeenCalledWith('https://s3.example/put', expect.objectContaining({ method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: poster }))
  })

  it('never throws and uploads nothing when the frame cannot be captured or the upload is refused', async () => {
    const put = vi.fn()
    expect(await uploadVideoPoster({ videoStoragePath, source: 'blob:x', createUpload: vi.fn(), capture: async () => null, put })).toBe(false)
    expect(await uploadVideoPoster({
      videoStoragePath,
      source: 'blob:x',
      createUpload: async () => ({ ok: false as const, error: 'no' }),
      capture: async () => new Blob(['x']),
      put,
    })).toBe(false)
    expect(await uploadVideoPoster({ videoStoragePath, source: 'blob:x', createUpload: async () => { throw new Error('boom') }, capture: async () => new Blob(['x']), put })).toBe(false)
    expect(put).not.toHaveBeenCalled()
  })

  it('keeps posters small', () => {
    expect(POST_VIDEO_POSTER_MAX_BYTES).toBeLessThanOrEqual(512 * 1024)
  })
})
