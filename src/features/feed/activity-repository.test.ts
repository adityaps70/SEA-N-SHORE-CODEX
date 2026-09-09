import { describe, expect, it } from 'vitest'
import { createFeedRepository } from './repository'

describe('feed activity repository', () => {
  it('returns each post the viewer commented on once, ordered by latest viewer comment', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createFeedRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return []
      },
    })

    await repository.listCommentedRows({ viewerProfileId: 'viewer-1', limit: 100 })

    const sql = seen[0]?.text ?? ''
    expect(sql).toContain('where c.author_id = $1')
    expect(sql).toContain('c.deleted_at is null')
    expect(sql).toContain('group by c.post_id')
    expect(sql).toContain('max(c.created_at) as last_commented_at')
    expect(sql).toContain('order by viewer_activity.last_commented_at desc, p.id desc')
    expect(seen[0]?.values).toEqual(['viewer-1', 100])
  })
})
