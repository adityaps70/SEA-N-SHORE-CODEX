import { describe, expect, it, vi } from 'vitest'
import type { AwsVerifiedUser } from '@/features/auth/aws-queries'
import type { FeedPostRow } from './mappers'
import type { FeedRepository } from './repository'
import { buildFeedCursorFilter, feedNextCursor } from './queries'

const viewerId = '11111111-1111-4111-8111-111111111111'

function row(id: string, createdAt: string): FeedPostRow {
  return {
    id,
    category: 'technical_discussion',
    body: 'A useful maritime lesson.',
    post_type: 'standard',
    created_at: createdAt,
    updated_at: createdAt,
    profiles: {
      id: '22222222-2222-4222-8222-222222222222',
      slug: 'captain-example',
      full_name: 'Captain Example',
      avatar_path: null,
      headline: 'Master Mariner',
      maritime_profiles: { rank: 'Master', current_company: 'Example Shipping' },
    },
    post_media: null,
    post_polls: null,
    post_reactions: { count: 0 },
    post_comment_count: { count: 0 },
  }
}

describe('feed query helpers', () => {
  it('builds a strict created-at/id tie-break cursor', () => {
    expect(buildFeedCursorFilter({
      createdAt: '2026-09-02T10:00:00.000Z',
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })).toBe(
      'created_at.lt.2026-09-02T10:00:00.000Z,and(created_at.eq.2026-09-02T10:00:00.000Z,id.lt.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa)',
    )
  })

  it('anchors the next cursor to the original recency page tail', () => {
    const pageRows = [
      { id: 'p1', created_at: '2026-09-02T12:00:00.000Z' },
      { id: 'p2', created_at: '2026-09-02T11:00:00.000Z' },
      { id: 'p3', created_at: '2026-09-02T10:00:00.000Z' },
    ]

    expect(feedNextCursor(pageRows, true)).toEqual({
      createdAt: '2026-09-02T10:00:00.000Z',
      id: 'p3',
    })
    expect(feedNextCursor(pageRows, false)).toBeNull()
  })
})

describe('Aurora feed queries', () => {
  it('uses the permanent AWS profile UUID for feed pagination and viewer hydration', async () => {
    const rows = [
      row('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-09-05T07:00:00.000Z'),
      row('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2026-09-05T06:00:00.000Z'),
    ]
    const repository = {
      listFeedRows: vi.fn(async () => rows),
      getViewerState: vi.fn(async () => ({
        likedPostIds: new Set([rows[0].id]),
        savedPostIds: new Set<string>(),
        pollVotes: new Map<string, string>(),
      })),
      getComments: vi.fn(async () => []),
    } as unknown as FeedRepository
    const requireUser = vi.fn(async (): Promise<AwsVerifiedUser> => ({
      id: viewerId,
      cognitoSub: 'cognito-subject-not-an-app-id',
      email: 'viewer@example.com',
    }))
    const { createFeedQueries } = await import('./queries')
    const queries = createFeedQueries({
      requireUser,
      repository,
      getPreferredAuthorIds: vi.fn(async () => []),
      resolveMediaUrls: vi.fn(async () => new Map()),
    })

    const page = await queries.getFeedPage({ category: 'technical_discussion', limit: 1 })

    expect(repository.listFeedRows).toHaveBeenCalledWith({
      viewerProfileId: viewerId,
      category: 'technical_discussion',
      limit: 2,
    })
    expect(repository.getViewerState).toHaveBeenCalledWith(viewerId, [rows[0].id])
    expect(page.posts[0].viewer.hasLiked).toBe(true)
    expect(page.nextCursor).toEqual({ createdAt: rows[0].created_at, id: rows[0].id })
  })

  it('loads one post through the same viewer-scoped repository path', async () => {
    const post = row('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-09-05T07:00:00.000Z')
    const repository = {
      getPostRow: vi.fn(async () => post),
      getViewerState: vi.fn(async () => ({ likedPostIds: new Set(), savedPostIds: new Set(), pollVotes: new Map() })),
      getComments: vi.fn(async () => []),
    } as unknown as FeedRepository
    const { createFeedQueries } = await import('./queries')
    const queries = createFeedQueries({
      requireUser: async () => ({ id: viewerId, cognitoSub: 'sub', email: null }),
      repository,
      getPreferredAuthorIds: vi.fn(async () => []),
      resolveMediaUrls: vi.fn(async () => new Map()),
    })

    await expect(queries.getPostById(post.id)).resolves.toMatchObject({ id: post.id })
    expect(repository.getPostRow).toHaveBeenCalledWith(viewerId, post.id)
  })
})
