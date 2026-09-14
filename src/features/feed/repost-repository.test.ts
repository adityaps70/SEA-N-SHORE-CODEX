import { describe, expect, it, vi } from 'vitest'
import type { FeedPostRow } from './mappers'

const viewerId = '11111111-1111-4111-8111-111111111111'
const sourcePostId = '22222222-2222-4222-8222-222222222222'
const repostId = '33333333-3333-4333-8333-333333333333'

type QueryCall = [text: string, values?: readonly unknown[]]

function callsOf(query: { mock: { calls: unknown[] } }): QueryCall[] {
  return query.mock.calls as unknown as QueryCall[]
}

describe('repost repository invariants', () => {
  it('requires the canonical repost source itself to remain visible to the viewer', async () => {
    const query = vi.fn(async () => [] as FeedPostRow[])
    const { createFeedRepository } = await import('./repository')
    const repository = createFeedRepository({ query })

    await repository.listFeedRows({ viewerProfileId: viewerId, limit: 21 })

    const [sql] = callsOf(query)[0]
    expect(sql).toMatch(/repost_of_post_id/i)
    expect(sql).toMatch(/source\.deleted_at is null/i)
    expect(sql).toMatch(/source\.post_type <> 'repost'/i)
    expect(sql).toMatch(/source_author\.account_status = 'active'/i)
    expect(sql).toMatch(/source_author\.onboarding_completed_at is not null/i)
    expect(sql).toMatch(/user_blocks[\s\S]*source\.author_id/i)
  })

  it('creates a content-free repost from a live non-repost source with one insert-select mutation', async () => {
    const query = vi.fn(async () => [{ id: repostId }])
    const { createFeedRepository } = await import('./repository')
    const repository = createFeedRepository({ query }) as unknown as {
      insertRepost(input: { id: string; authorId: string; sourcePostId: string }): Promise<void>
    }

    await repository.insertRepost({ id: repostId, authorId: viewerId, sourcePostId })

    const [sql, values] = callsOf(query)[0]
    expect(sql).toMatch(/insert into public\.posts\s*\(id, author_id, category, body, post_type, repost_of_post_id\)/i)
    expect(sql).toMatch(/select\s+\$1,\s*\$2,\s*source\.category,\s*'',\s*'repost',\s*source\.id/i)
    expect(sql).toMatch(/from public\.posts source/i)
    expect(sql).toMatch(/source\.id = \$3/i)
    expect(sql).toMatch(/source\.deleted_at is null/i)
    expect(sql).toMatch(/source\.post_type <> 'repost'/i)
    expect(values).toEqual([repostId, viewerId, sourcePostId])
  })
})
