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
  it('lists only the viewer own recoverable recently deleted posts and excludes moderator deletions', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createFeedRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return [{
          id: 'post-1',
          category: 'technical_discussion',
          body: 'Deleted bridge lesson',
          deleted_at: '2026-09-23T10:00:00.000Z',
          purge_after: '2026-10-23T10:00:00.000Z',
        }]
      },
    })

    await expect(repository.listOwnRecentlyDeletedPosts('viewer-1')).resolves.toEqual([{
      id: 'post-1',
      category: 'technical_discussion',
      body: 'Deleted bridge lesson',
      deletedAt: '2026-09-23T10:00:00.000Z',
      purgeAfter: '2026-10-23T10:00:00.000Z',
    }])

    const sql = seen[0]?.text ?? ''
    expect(sql).toMatch(/p\.author_id = \$1/i)
    expect(sql).toMatch(/p\.deleted_by = \$1/i)
    expect(sql).toMatch(/p\.deleted_at is not null/i)
    expect(sql).toMatch(/p\.purge_after > now\(\)/i)
    expect(sql).toMatch(/order by p\.deleted_at desc/i)
    expect(seen[0]?.values).toEqual(['viewer-1'])
  })

  it('restores only a still-retained post deleted by its author and writes an audit event', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createFeedRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        if (text.includes('update public.posts')) return [{ id: 'post-1' }]
        return []
      },
    })

    await expect(repository.restoreOwnDeletedPost('viewer-1', 'post-1')).resolves.toBe(true)

    const restore = seen.find((entry) => entry.text.includes('update public.posts'))
    expect(restore?.text).toMatch(/author_id = \$1/i)
    expect(restore?.text).toMatch(/deleted_by = \$1/i)
    expect(restore?.text).toMatch(/purge_after > now\(\)/i)
    expect(restore?.text).toMatch(/deleted_at = null/i)
    expect(restore?.text).toMatch(/deletion_reason = null/i)
    expect(restore?.values).toEqual(['viewer-1', 'post-1'])

    const audit = seen.find((entry) => entry.text.includes('insert into public.audit_events'))
    expect(audit?.text).toMatch(/content\.post_restored_by_author/i)
    expect(audit?.values).toEqual(['viewer-1', 'post-1'])
  })

})
