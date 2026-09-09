import { describe, expect, it } from 'vitest'
import { createFeedRepository } from './repository'

describe('feed activity repository', () => {
  it('returns every post the viewer commented on once, ordered by latest viewer comment', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createFeedRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return []
      },
    })

    await repository.listCommentedRows({ viewerProfileId: 'viewer-1' })

    const sql = seen[0]?.text ?? ''
    expect(sql).toContain('where c.author_id = $1')
    expect(sql).toContain('c.deleted_at is null')
    expect(sql).toContain('group by c.post_id')
    expect(sql).toContain('max(c.created_at) as last_commented_at')
    expect(sql).toContain('order by viewer_activity.last_commented_at desc, p.id desc')
    expect(sql).not.toContain('limit $2')
    expect(seen[0]?.values).toEqual(['viewer-1'])
  })

  it('can return all authored posts without a profile-page limit', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createFeedRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return []
      },
    })

    await repository.listAuthorRows({ viewerProfileId: 'viewer-1', authorProfileId: 'viewer-1' })

    expect(seen[0]?.text).toContain('where p.author_id = $2')
    expect(seen[0]?.text).not.toContain('limit $3')
    expect(seen[0]?.values).toEqual(['viewer-1', 'viewer-1'])
  })
})
