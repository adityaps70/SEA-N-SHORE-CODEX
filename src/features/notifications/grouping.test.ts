import { describe, expect, it } from 'vitest'
import { groupNotifications } from './grouping'
import type { NetworkNotification } from './types'

let sequence = 0
function row(type: NetworkNotification['type'], input: { postId?: string; actor?: string; hoursAgo?: number; read?: boolean } = {}): NetworkNotification {
  sequence += 1
  return {
    id: `n${sequence}`,
    type,
    createdAt: new Date(Date.UTC(2026, 9, 13, 12) - (input.hoursAgo ?? 0) * 3_600_000).toISOString(),
    readAt: input.read ? '2026-10-13T12:00:00.000Z' : null,
    actor: input.actor ? { id: input.actor, slug: input.actor, fullName: `Placeholder ${input.actor}` } : null,
    message: 'original',
    destination: input.postId ? `/posts/${input.postId}` : '/network',
    postId: input.postId ?? null,
  }
}

describe('notification grouping (round G)', () => {
  it('merges reactions on the same post within 24 hours, newest actor first', () => {
    const rows = [
      row('post_reaction', { postId: 'p1', actor: 'a', hoursAgo: 1 }),
      row('post_reaction', { postId: 'p1', actor: 'b', hoursAgo: 2, read: true }),
      row('post_reaction', { postId: 'p1', actor: 'c', hoursAgo: 3 }),
      row('post_reaction', { postId: 'p1', actor: 'd', hoursAgo: 30 }),
      row('post_reaction', { postId: 'p2', actor: 'e', hoursAgo: 4 }),
    ]
    const grouped = groupNotifications(rows)
    expect(grouped).toHaveLength(3)
    expect(grouped[0]).toMatchObject({ message: 'Placeholder a and 2 others reacted to your post.', groupCount: 3, groupIds: ['n1', 'n2', 'n3'], readAt: null, destination: '/posts/p1' })
    expect(grouped[1]!.groupIds).toBeUndefined()
  })

  it('never merges mentions, and marks them important until read', () => {
    const rows = [
      row('post_mention', { postId: 'p1', actor: 'a', hoursAgo: 1 }),
      row('post_mention', { postId: 'p1', actor: 'b', hoursAgo: 2 }),
      row('post_reaction', { postId: 'p1', actor: 'c', hoursAgo: 3 }),
      row('connection_request', { actor: 'd', hoursAgo: 4 }),
    ]
    const grouped = groupNotifications(rows)
    expect(grouped).toHaveLength(4)
    expect(grouped.filter((item) => item.important).map((item) => item.type)).toEqual(['post_mention', 'post_mention', 'connection_request'])
  })

  it('keeps reactions and comments on the same post apart', () => {
    const grouped = groupNotifications([
      row('post_comment', { postId: 'p1', actor: 'a', hoursAgo: 1 }),
      row('post_reaction', { postId: 'p1', actor: 'b', hoursAgo: 2 }),
      row('post_comment', { postId: 'p1', actor: 'c', hoursAgo: 3 }),
    ])
    expect(grouped.map((item) => item.message)).toEqual(['Placeholder a and 1 other commented on your post.', 'original'])
  })
})
