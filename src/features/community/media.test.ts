import { describe, expect, it } from 'vitest'
import {
  COMMUNITY_IMAGE_CONTENT_TYPES,
  COMMUNITY_IMAGE_MAX_BYTES,
  buildCommunityMediaKey,
  isCommunityImageContentType,
  isCommunityMediaKind,
  validateCommunityImage,
} from './media'

const groupId = '22222222-2222-4222-8222-222222222222'

describe('community media policy', () => {
  it('caps images at 5 MB and accepts jpg, png and webp only', () => {
    expect(COMMUNITY_IMAGE_MAX_BYTES).toBe(5 * 1024 * 1024)
    expect([...COMMUNITY_IMAGE_CONTENT_TYPES].sort()).toEqual(['image/jpeg', 'image/png', 'image/webp'])
    expect(validateCommunityImage({ type: 'image/jpeg', size: 1024 })).toEqual({ ok: true })
    expect(validateCommunityImage({ type: 'image/png', size: COMMUNITY_IMAGE_MAX_BYTES })).toEqual({ ok: true })
    expect(validateCommunityImage({ type: 'image/webp', size: 1 })).toEqual({ ok: true })
  })

  it('rejects unsupported, empty and oversized files with a member-facing message', () => {
    expect(validateCommunityImage({ type: 'image/gif', size: 1024 })).toEqual({ ok: false, error: 'Please upload a JPG, PNG or WebP image.' })
    expect(validateCommunityImage({ type: 'image/svg+xml', size: 1024 }).ok).toBe(false)
    expect(validateCommunityImage({ type: 'image/jpeg', size: 0 })).toEqual({ ok: false, error: 'Image must be 5 MB or smaller.' })
    expect(validateCommunityImage({ type: 'image/jpeg', size: COMMUNITY_IMAGE_MAX_BYTES + 1 }).ok).toBe(false)
    expect(validateCommunityImage({ type: 'image/jpeg', size: Number.NaN }).ok).toBe(false)
  })

  it('builds private bucket keys under communities/<groupId>/<kind>-<uuid>.<ext>', () => {
    expect(buildCommunityMediaKey(groupId, 'cover', 'image/png')).toMatch(
      /^communities\/22222222-2222-4222-8222-222222222222\/cover-[a-f0-9-]{36}\.png$/,
    )
    expect(buildCommunityMediaKey(groupId, 'icon', 'image/jpeg')).toMatch(/\/icon-[a-f0-9-]{36}\.jpg$/)
    expect(buildCommunityMediaKey(groupId, 'icon', 'image/webp')).toMatch(/\.webp$/)
    expect(buildCommunityMediaKey(groupId, 'icon', 'image/webp')).not.toBe(buildCommunityMediaKey(groupId, 'icon', 'image/webp'))
    expect(() => buildCommunityMediaKey(groupId, 'icon', 'image/gif')).toThrow('community_media_type_unsupported')
  })

  it('recognises the two media kinds and the served content types', () => {
    expect(isCommunityMediaKind('cover')).toBe(true)
    expect(isCommunityMediaKind('icon')).toBe(true)
    expect(isCommunityMediaKind('logo')).toBe(false)
    expect(isCommunityMediaKind(undefined)).toBe(false)
    expect(isCommunityImageContentType('image/webp')).toBe(true)
    expect(isCommunityImageContentType('text/html')).toBe(false)
    expect(isCommunityImageContentType(null)).toBe(false)
  })
})
