import { describe, expect, it } from 'vitest'
import { createBlockedMembersRepository } from './blocked-members-repository'

describe('blocked members repository', () => {
  it('lists only blocks the viewer made, newest first, and hides details of accounts that are no longer active', async () => {
    const seen: { text: string; values?: readonly unknown[] }[] = []
    const repository = createBlockedMembersRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return [
          { id: 'p-1', full_name: 'Rinki Mukharjee', slug: 'rinki', headline: 'Shore professional', avatar_path: 'a.jpg', account_status: 'active', blocked_at: new Date('2026-09-02T10:00:00.000Z') },
          { id: 'p-2', full_name: null, slug: 'gone', headline: 'Old headline', avatar_path: 'b.jpg', account_status: 'deletion_requested', blocked_at: '2026-08-12T10:00:00.000Z' },
        ]
      },
    })

    await expect(repository.listBlockedByViewer('viewer-1')).resolves.toEqual([
      { id: 'p-1', fullName: 'Rinki Mukharjee', slug: 'rinki', headline: 'Shore professional', avatarPath: 'a.jpg', blockedAt: '2026-09-02T10:00:00.000Z' },
      { id: 'p-2', fullName: 'Sea N Shore member', slug: null, headline: null, avatarPath: null, blockedAt: '2026-08-12T10:00:00.000Z' },
    ])
    expect(seen[0].values).toEqual(['viewer-1', 200])
    expect(seen[0].text).toContain('from public.user_blocks b')
    expect(seen[0].text).toContain('where b.blocker_id = $1')
    expect(seen[0].text).not.toContain('b.blocked_id = $1')
    expect(seen[0].text).toContain('order by b.created_at desc')
  })
})
