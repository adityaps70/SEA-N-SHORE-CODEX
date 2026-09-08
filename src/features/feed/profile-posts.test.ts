import { describe, expect, it, vi } from 'vitest'
import type { FeedPostRow } from './mappers'
import type { FeedRepository } from './repository'

const viewerId = '11111111-1111-4111-8111-111111111111'
const profileId = '22222222-2222-4222-8222-222222222222'
const postId = '33333333-3333-4333-8333-333333333333'

function row(): FeedPostRow {
  return {
    id: postId,
    category: 'learning',
    body: 'Shared a tanker safety lesson.',
    post_type: 'standard',
    created_at: '2026-09-09T10:00:00.000Z',
    updated_at: '2026-09-09T10:00:00.000Z',
    profiles: {
      id: profileId,
      slug: 'captain-example',
      full_name: 'Captain Example',
      avatar_path: 'profiles/member/avatar.webp',
      headline: 'Master Mariner',
      maritime_profiles: { rank: 'Master', current_company: 'Example Shipping' },
    },
    post_media: null,
    post_polls: null,
    post_reactions: { count: 0 },
    post_comment_count: { count: 0 },
  }
}

describe('profile posts query', () => {
  it('loads one member posts newest-first through signed-in viewer visibility rules', async () => {
    const postRow = row()
    const repository = {
      listAuthorRows: vi.fn(async () => [postRow]),
      getViewerState: vi.fn(async () => ({ likedPostIds: new Set(), savedPostIds: new Set(), pollVotes: new Map() })),
      getComments: vi.fn(async () => []),
    } as unknown as FeedRepository
    const resolveMediaUrls = vi.fn(async (paths: string[]) => new Map(paths.map((path) => [path, `https://signed.example/${path}`])))
    const { createFeedQueries } = await import('./queries')
    const queries = createFeedQueries({
      requireUser: async () => ({ id: viewerId, cognitoSub: 'sub', email: null }),
      repository,
      getPreferredAuthorIds: vi.fn(async () => []),
      resolveMediaUrls,
    })

    const posts = await queries.getPostsByAuthor(profileId)

    expect(repository.listAuthorRows).toHaveBeenCalledWith({
      viewerProfileId: viewerId,
      authorProfileId: profileId,
      limit: 30,
    })
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({
      id: postId,
      author: {
        id: profileId,
        avatarUrl: 'https://signed.example/profiles/member/avatar.webp',
      },
      viewerOwns: false,
    })
  })
})
