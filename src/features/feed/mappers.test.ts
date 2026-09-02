import { describe, expect, it } from 'vitest'
import { mapFeedPost, type FeedPostRow } from './mappers'

const viewer = {
  likedPostIds: new Set(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']),
  savedPostIds: new Set(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']),
  pollVotes: new Map([['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'option-b']]),
}

function row(overrides: Partial<FeedPostRow> = {}): FeedPostRow {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    category: 'technical_discussion',
    body: 'Technical lesson',
    post_type: 'poll',
    created_at: '2026-09-02T10:00:00.000Z',
    updated_at: '2026-09-02T10:00:00.000Z',
    profiles: {
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'member-a',
      full_name: 'Member A',
      avatar_path: null,
      headline: 'Chief Officer | Tankers',
      maritime_profiles: null,
    },
    post_media: {
      storage_path: '111/post/image.jpg',
      mime_type: 'image/jpeg',
      alt_text: 'Engine room diagram',
    },
    post_polls: {
      post_poll_options: [
        { id: 'option-b', label: 'B', position: 1, post_poll_votes: [{ count: 2 }] },
        { id: 'option-a', label: 'A', position: 0, post_poll_votes: [{ count: 3 }] },
      ],
    },
    post_reactions: [{ count: 7 }],
    post_comments: [],
    ...overrides,
  }
}

describe('mapFeedPost', () => {
  it('maps missing maritime summary values to null', () => {
    const mapped = mapFeedPost(row(), viewer)
    expect(mapped.author.rank).toBeNull()
    expect(mapped.author.currentCompany).toBeNull()
  })

  it('maps viewer state, counts, signed media and ordered poll options', () => {
    const signed = new Map([['111/post/image.jpg', 'https://example.test/signed-image']])
    const mapped = mapFeedPost(row(), viewer, signed)
    expect(mapped.likeCount).toBe(7)
    expect(mapped.viewerLiked).toBe(true)
    expect(mapped.viewerSaved).toBe(true)
    expect(mapped.media?.signedUrl).toBe('https://example.test/signed-image')
    expect(mapped.poll?.viewerOptionId).toBe('option-b')
    expect(mapped.poll?.totalVotes).toBe(5)
    expect(mapped.poll?.options.map((option) => option.id)).toEqual(['option-a', 'option-b'])
  })

  it('maps comments with real authors', () => {
    const mapped = mapFeedPost(row({
      post_type: 'standard',
      post_polls: null,
      post_comments: [{
        id: 'comment-1',
        body: 'Useful lesson',
        created_at: '2026-09-02T10:05:00.000Z',
        profiles: {
          id: '22222222-2222-4222-8222-222222222222',
          slug: 'member-b',
          full_name: 'Member B',
          avatar_path: null,
          headline: null,
          maritime_profiles: { rank: 'Second Engineer', current_company: 'Example Shipping' },
        },
      }],
    }), viewer)
    expect(mapped.comments[0]?.author.rank).toBe('Second Engineer')
    expect(mapped.commentCount).toBe(1)
  })
})
