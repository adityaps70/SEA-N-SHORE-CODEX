import { describe, expect, it, vi } from 'vitest'
import { createProfileMediaRepository } from './profile-media-repository'

describe('profile media repository', () => {
  it('updates only the requested media field and returns the previous key', async () => {
    const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
      void sql
      void values
      return { rows: [{ previous_path: 'profiles/u/old.webp' }] }
    })
    const repository = createProfileMediaRepository({ query } as never)

    const previous = await repository.replaceMediaPath(
      '11111111-1111-4111-8111-111111111111',
      'avatar',
      'profiles/u/avatar-new.webp',
    )

    expect(previous).toBe('profiles/u/old.webp')
    expect(query).toHaveBeenCalledTimes(1)
    const [sql, values] = query.mock.calls[0]
    expect(sql).toContain('avatar_path')
    expect(sql).not.toContain('cover_path = $2')
    expect(values).toEqual([
      '11111111-1111-4111-8111-111111111111',
      'profiles/u/avatar-new.webp',
    ])
  })
})
