import { describe, expect, it } from 'vitest'
import { buildProfileMediaKey, validateProfileImage } from './profile-media'

describe('profile media', () => {
  it('accepts bounded jpg, png and webp uploads', () => {
    expect(validateProfileImage({ type: 'image/jpeg', size: 1024 })).toEqual({ ok: true })
    expect(validateProfileImage({ type: 'image/png', size: 1024 })).toEqual({ ok: true })
    expect(validateProfileImage({ type: 'image/webp', size: 1024 })).toEqual({ ok: true })
  })

  it('rejects unsupported or oversized files', () => {
    expect(validateProfileImage({ type: 'image/gif', size: 1024 }).ok).toBe(false)
    expect(validateProfileImage({ type: 'image/jpeg', size: 6 * 1024 * 1024 }).ok).toBe(false)
  })

  it('builds stable private S3 keys for avatar and cover media', () => {
    expect(buildProfileMediaKey('11111111-1111-4111-8111-111111111111', 'avatar', 'image/png')).toMatch(
      /^profiles\/11111111-1111-4111-8111-111111111111\/avatar-[a-f0-9-]+\.png$/,
    )
    expect(buildProfileMediaKey('11111111-1111-4111-8111-111111111111', 'cover', 'image/webp')).toMatch(
      /^profiles\/11111111-1111-4111-8111-111111111111\/cover-[a-f0-9-]+\.webp$/,
    )
  })
})
