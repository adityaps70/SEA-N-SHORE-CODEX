import { describe, expect, it, vi } from 'vitest'
import {
  COMMUNITY_MEDIA_FAILURE_NOTICE,
  communityMediaCancelDestination,
  uploadRemainingCreationImages,
} from './creation-media-flow'

const groupId = '22222222-2222-4222-8222-222222222222'
const cover = new File(['cover'], 'banner.webp', { type: 'image/webp' })
const icon = new File(['icon'], 'photo.webp', { type: 'image/webp' })

describe('creation media: failure, cancellation and retry', () => {
  it('cancel-after-failure routes to the created community with an upload failure notice', async () => {
    const completed: Array<'cover' | 'icon'> = []
    const upload = vi.fn().mockRejectedValueOnce(new Error('S3 unavailable'))
    const result = await uploadRemainingCreationImages(groupId, { cover, icon }, completed, upload)
    expect(result).toEqual({ success: false, kind: 'cover', file: cover })
    expect(completed).toEqual([])
    // The cancel handler uses this destination; the page renders the notice from its query.
    expect(communityMediaCancelDestination('family-anchor'))
      .toBe('/community/family-anchor?mediaUpload=failed')
    expect(COMMUNITY_MEDIA_FAILURE_NOTICE)
      .toContain('Community created. The banner/photo didn’t upload')
  })

  it('retry-then-continue uploads every remaining selection before redirect', async () => {
    const completed: Array<'cover' | 'icon'> = []
    const upload = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValue(undefined)
    const files = { cover, icon }
    const first = await uploadRemainingCreationImages(groupId, files, completed, upload)
    expect(first).toEqual({ success: false, kind: 'cover', file: cover })
    // The crop dialog's retry succeeds for the failed cover.
    await upload(groupId, 'cover', cover)
    completed.push('cover')
    const next = await uploadRemainingCreationImages(groupId, files, completed, upload)
    expect(next).toEqual({ success: true })
    expect(completed).toEqual(['cover', 'icon'])
    expect(upload.mock.calls.map((args) => args[1])).toEqual(['cover', 'cover', 'icon'])
  })
})
