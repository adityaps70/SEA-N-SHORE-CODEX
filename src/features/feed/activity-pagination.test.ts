import { describe, expect, it, vi } from 'vitest'
import type { AwsVerifiedUser } from '@/features/auth/aws-queries'
import type { FeedPostRow } from './mappers'
import { createFeedQueries, feedNextCursor, feedRowCursor, ACTIVITY_PAGE_SIZE } from './queries'
import { createFeedRepository, cursorTimestampSql, type FeedRepository } from './repository'

const viewerId = '11111111-1111-4111-8111-111111111111'
const postA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const cursorAt = '2026-09-05T07:00:00.123456Z'

function row(id: string, createdAt: string, cursor: string | null = null): FeedPostRow {
  return {
    id,
    category: 'technical_discussion',
    body: 'A useful maritime lesson.',
    post_type: 'standard',
    created_at: createdAt,
    updated_at: createdAt,
    cursor_at: cursor,
    profiles: {
      id: viewerId,
      slug: 'viewer',
      full_name: 'Viewer Example',
      avatar_path: null,
      headline: null,
      maritime_profiles: null,
    },
    post_media: null,
    post_polls: null,
    post_reactions: { count: 0 },
    post_comment_count: { count: 0 },
  }
}

function recordingRepository() {
  const seen: Array<{ text: string; values?: readonly unknown[] }> = []
  const repository = createFeedRepository({
    query: async (text, values) => {
      seen.push({ text, values })
      return []
    },
  })
  return { repository, seen }
}

function uuid(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}

describe('activity cursor encoding (Round 14, 3.7)', () => {
  it('writes the sort timestamp as fixed-width UTC text with microseconds', () => {
    expect(cursorTimestampSql('p.created_at')).toBe(`to_char((p.created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`)
  })

  it('takes the exact cursor text over the (rounded) created_at, and falls back to created_at', () => {
    expect(feedRowCursor(row(postA, '2026-09-05T07:00:00.123Z', cursorAt))).toEqual({ createdAt: cursorAt, id: postA })
    expect(feedRowCursor(row(postA, '2026-09-05T07:00:00.123Z'))).toEqual({ createdAt: '2026-09-05T07:00:00.123Z', id: postA })
  })

  it('anchors the next cursor to the page tail only when there is a next page', () => {
    const rows = [row(uuid(2), '2026-09-05T08:00:00Z', '2026-09-05T08:00:00.000002Z'), row(uuid(1), '2026-09-05T07:00:00Z', '2026-09-05T07:00:00.000001Z')]
    expect(feedNextCursor(rows, true)).toEqual({ createdAt: '2026-09-05T07:00:00.000001Z', id: uuid(1) })
    expect(feedNextCursor(rows, false)).toBeNull()
  })
})

describe('activity repository keyset SQL (Round 14, 3.7)', () => {
  it('selects the precise cursor column with every feed row', async () => {
    const { repository, seen } = recordingRepository()
    await repository.listFeedRows({ viewerProfileId: viewerId, limit: 13 })
    expect(seen[0]?.text).toContain(`${cursorTimestampSql('p.created_at')} as cursor_at`)
  })

  it('pages the member own posts by (created_at, id) with a limit', async () => {
    const { repository, seen } = recordingRepository()
    await repository.listAuthorRows({
      viewerProfileId: viewerId,
      authorProfileId: viewerId,
      cursor: { createdAt: cursorAt, id: postA },
      limit: ACTIVITY_PAGE_SIZE + 1,
    })

    const sql = seen[0]?.text ?? ''
    expect(sql).toContain('where p.author_id = $2')
    expect(sql).toContain('and (p.created_at < $3::timestamptz or (p.created_at = $3::timestamptz and p.id < $4::uuid))')
    expect(sql).toMatch(/order by p\.created_at desc, p\.id desc limit \$5$/)
    expect(seen[0]?.values).toEqual([viewerId, viewerId, cursorAt, postA, 21])
  })

  it('asks for the first page without a cursor clause', async () => {
    const { repository, seen } = recordingRepository()
    await repository.listAuthorRows({ viewerProfileId: viewerId, authorProfileId: viewerId, limit: 21 })

    expect(seen[0]?.text).not.toContain('p.created_at < $')
    expect(seen[0]?.text).toMatch(/limit \$3$/)
    expect(seen[0]?.values).toEqual([viewerId, viewerId, 21])
  })

  it('keeps the profile-page call (limit, personal only) unchanged', async () => {
    const { repository, seen } = recordingRepository()
    await repository.listAuthorRows({ viewerProfileId: viewerId, authorProfileId: viewerId, limit: 30, personalOnly: true })

    expect(seen[0]?.text).toMatch(/p\.deleted_at is null\s+and p\.company_id is null/)
    expect(seen[0]?.text).toMatch(/limit \$3$/)
    expect(seen[0]?.values).toEqual([viewerId, viewerId, 30])
  })

  it('pages commented posts by (latest viewer comment, post id) and exposes that time as the cursor', async () => {
    const { repository, seen } = recordingRepository()
    await repository.listCommentedRows({
      viewerProfileId: viewerId,
      cursor: { createdAt: cursorAt, id: postA },
      limit: 21,
    })

    const sql = seen[0]?.text ?? ''
    expect(sql).toContain(`${cursorTimestampSql('viewer_activity.last_commented_at')} as cursor_at`)
    expect(sql).toContain('and (viewer_activity.last_commented_at < $2::timestamptz or (viewer_activity.last_commented_at = $2::timestamptz and p.id < $3::uuid))')
    expect(sql).toMatch(/order by viewer_activity\.last_commented_at desc, p\.id desc limit \$4$/)
    expect(seen[0]?.values).toEqual([viewerId, cursorAt, postA, 21])
  })

  it('asks for the first page of commented posts with only a limit', async () => {
    const { repository, seen } = recordingRepository()
    await repository.listCommentedRows({ viewerProfileId: viewerId, limit: 21 })

    expect(seen[0]?.text).not.toContain('last_commented_at < $')
    expect(seen[0]?.text).toMatch(/limit \$2$/)
    expect(seen[0]?.values).toEqual([viewerId, 21])
  })
})

describe('My Activities queries paginate 20 per page (Round 14, 3.7)', () => {
  function queriesWith(repository: Partial<FeedRepository>) {
    const full = {
      getViewerState: vi.fn(async () => ({ likedPostIds: new Set<string>(), savedPostIds: new Set<string>(), pollVotes: new Map<string, string>() })),
      getComments: vi.fn(async () => []),
      ...repository,
    } as unknown as FeedRepository
    return createFeedQueries({
      requireUser: async (): Promise<AwsVerifiedUser> => ({ id: viewerId, cognitoSub: 'sub', email: null }),
      repository: full,
      getPreferredAuthorIds: vi.fn(async () => []),
      resolveMediaUrls: vi.fn(async () => new Map()),
    })
  }

  const rows = Array.from({ length: 21 }, (_, index) => {
    const second = String(59 - index).padStart(2, '0')
    return row(uuid(100 - index), `2026-09-05T07:00:${second}.000Z`, `2026-09-05T07:00:${second}.000500Z`)
  })

  it('loads 21 rows, shows 20 and points the next page at the 20th row', async () => {
    const listAuthorRows = vi.fn(async () => rows)
    const queries = queriesWith({ listAuthorRows })

    const page = await queries.getMyActivityPosts()

    expect(listAuthorRows).toHaveBeenCalledWith({ viewerProfileId: viewerId, authorProfileId: viewerId, limit: 21 })
    expect(page.entries).toHaveLength(20)
    expect(page.entries[0]).toEqual({ cursor: { createdAt: rows[0]!.cursor_at, id: rows[0]!.id }, item: expect.objectContaining({ id: rows[0]!.id }) })
    expect(page.nextCursor).toEqual({ createdAt: rows[19]!.cursor_at, id: rows[19]!.id })
  })

  it('passes the cursor through and ends the list on a short page', async () => {
    const listAuthorRows = vi.fn(async () => rows.slice(0, 3))
    const queries = queriesWith({ listAuthorRows })
    const cursor = { createdAt: cursorAt, id: postA }

    const page = await queries.getMyActivityPosts(cursor)

    expect(listAuthorRows).toHaveBeenCalledWith({ viewerProfileId: viewerId, authorProfileId: viewerId, cursor, limit: 21 })
    expect(page.entries.map((entry) => entry.item.id)).toEqual(rows.slice(0, 3).map((item) => item.id))
    expect(page.nextCursor).toBeNull()
  })

  it('pages comment activity the same way and keeps only the viewer comments on each card', async () => {
    const commented = rows.slice(0, 21)
    const listCommentedRows = vi.fn(async () => commented)
    const getComments = vi.fn(async () => [{
      id: uuid(900),
      post_id: commented[0]!.id,
      body: 'My contribution',
      created_at: '2026-09-05T09:00:00.000Z',
      profiles: { id: viewerId, slug: 'viewer', full_name: 'Viewer Example', avatar_path: null, headline: null, maritime_profiles: null },
    }, {
      id: uuid(901),
      post_id: commented[0]!.id,
      body: 'Someone else',
      created_at: '2026-09-05T09:05:00.000Z',
      profiles: { id: uuid(5), slug: 'other', full_name: 'Other', avatar_path: null, headline: null, maritime_profiles: null },
    }])
    const queries = queriesWith({ listCommentedRows, getComments })
    const cursor = { createdAt: cursorAt, id: postA }

    const page = await queries.getMyCommentActivity(cursor)

    expect(listCommentedRows).toHaveBeenCalledWith({ viewerProfileId: viewerId, cursor, limit: 21 })
    expect(page.entries).toHaveLength(20)
    expect(page.entries[0]?.item.viewerComments.map((comment) => comment.body)).toEqual(['My contribution'])
    expect(page.nextCursor).toEqual({ createdAt: commented[19]!.cursor_at, id: commented[19]!.id })
  })
})
