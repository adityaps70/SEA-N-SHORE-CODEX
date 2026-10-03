import { describe, expect, it } from 'vitest'
import { mapFeedPost, type FeedPostRow } from './mappers'

const repostId = '11111111-1111-4111-8111-111111111111'
const sourcePostId = '22222222-2222-4222-8222-222222222222'

const viewer = {
  postReactions: new Map(),
  likedPostIds: new Set<string>(),
  savedPostIds: new Set<string>(),
  pollVotes: new Map<string, string>(),
}

describe('repost feed mapping', () => {
  it('keeps the repost wrapper content-free and maps the canonical original post for rendering', () => {
    const row = {
      id: repostId,
      category: 'safety_lessons',
      body: '',
      post_type: 'repost',
      created_at: '2026-09-14T09:00:00.000Z',
      updated_at: '2026-09-14T09:00:00.000Z',
      profiles: {
        id: '33333333-3333-4333-8333-333333333333',
        slug: 'reposter',
        full_name: 'Reposter Member',
        avatar_path: null,
        headline: 'Master Mariner',
        maritime_profiles: null,
      },
      post_media: null,
      post_polls: null,
      post_reactions: { like: 0, support: 0, respect: 0, on_point: 0 },
      post_comment_count: { count: 0 },
      post_mentions: [],
      post_comments: [],
      repost_source: {
        id: sourcePostId,
        category: 'safety_lessons',
        body: 'Original enclosed-space safety lesson.',
        post_type: 'standard',
        created_at: '2026-09-13T08:00:00.000Z',
        updated_at: '2026-09-13T08:00:00.000Z',
        profiles: {
          id: '44444444-4444-4444-8444-444444444444',
          slug: 'original-author',
          full_name: 'Original Author',
          avatar_path: 'profiles/original/avatar.webp',
          headline: 'Chief Officer',
          maritime_profiles: { rank: 'Chief Officer', current_company: 'Example Shipping' },
        },
        post_media: {
          storage_path: 'posts/original/image.webp',
          mime_type: 'image/webp',
          alt_text: 'Enclosed-space checklist',
        },
        post_polls: null,
        post_mentions: [],
      },
    } as unknown as FeedPostRow
    const signed = new Map([
      ['profiles/original/avatar.webp', 'https://example.test/original-avatar'],
      ['posts/original/image.webp', 'https://example.test/original-image'],
    ])

    const mapped = mapFeedPost(row, viewer, signed, '33333333-3333-4333-8333-333333333333') as unknown as {
      body: string
      postType: string
      repostOf?: {
        id: string
        body: string
        author: { fullName: string; avatarUrl: string | null }
        media: { signedUrl: string | null } | null
      } | null
    }

    expect(mapped.body).toBe('')
    expect(mapped.postType).toBe('repost')
    expect(mapped.repostOf).toMatchObject({
      id: sourcePostId,
      body: 'Original enclosed-space safety lesson.',
      author: { fullName: 'Original Author', avatarUrl: 'https://example.test/original-avatar' },
      media: { signedUrl: 'https://example.test/original-image' },
    })
  })
})
