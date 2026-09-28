import { describe, expect, it, vi } from 'vitest'
import { withAdminAvatarUrls } from './avatars'

describe('withAdminAvatarUrls', () => {
  it('signs each distinct photo once and leaves rows without a photo on initials', async () => {
    const signUrl = vi.fn(async (key: string) => `https://media.example/${key}?signed`)
    const rows = await withAdminAvatarUrls([
      { id: 'a', avatarPath: 'profiles/a/avatar-1.jpg' },
      { id: 'b', avatarPath: null },
      { id: 'c', avatarPath: 'profiles/a/avatar-1.jpg' },
      { id: 'd' },
    ], signUrl)

    expect(signUrl).toHaveBeenCalledTimes(1)
    expect(signUrl).toHaveBeenCalledWith('profiles/a/avatar-1.jpg', 900)
    expect(rows.map((row) => row.avatarUrl)).toEqual([
      'https://media.example/profiles/a/avatar-1.jpg?signed',
      null,
      'https://media.example/profiles/a/avatar-1.jpg?signed',
      null,
    ])
  })

  it('falls back to initials when a photo cannot be signed', async () => {
    const rows = await withAdminAvatarUrls([{ avatarPath: 'profiles/x/avatar.png' }], async () => {
      throw new Error('aws_media_bucket_missing')
    })
    expect(rows[0]?.avatarUrl).toBeNull()
  })
})
