import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeedPhotoTag, FeedPost } from '../types'
import { PostCard } from './post-card'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/home',
}))

vi.mock('../actions', () => ({
  loadReactionDetails: vi.fn(async () => ({ ok: true, page: { reactors: [], nextCursor: null } })),
  deletePost: vi.fn(async () => ({ ok: true })),
  repostPost: vi.fn(async () => ({ ok: true, postId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })),
  setPostReaction: vi.fn(async () => ({ ok: true })),
  setPostSaved: vi.fn(async () => ({ ok: true })),
  setPostHidden: vi.fn(async () => ({ ok: true })),
  setCommentReaction: vi.fn(async () => ({ ok: true })),
  setPollVote: vi.fn(async () => ({ ok: true })),
  addComment: vi.fn(async () => ({ ok: true })),
}))

vi.mock('../photo-tag-actions', () => ({ removeMyPhotoTag: vi.fn(async () => ({ ok: true })) }))

const mediaOne = '66666666-6666-4666-8666-666666666666'
const mediaTwo = '77777777-7777-4777-8777-777777777777'

const priya: FeedPhotoTag = { mediaId: mediaOne, profileId: '22222222-2222-4222-8222-222222222222', slug: 'priya-nair', fullName: 'Priya Nair', avatarUrl: null }
const arjun: FeedPhotoTag = { mediaId: mediaOne, profileId: '33333333-3333-4333-8333-333333333333', slug: 'arjun-mehta', fullName: 'Arjun Mehta', avatarUrl: null }
const lee: FeedPhotoTag = { mediaId: mediaTwo, profileId: '44444444-4444-4444-8444-444444444444', slug: 'officer-lee', fullName: 'Officer Lee', avatarUrl: null }

function post(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    category: 'achievement',
    body: 'Crew change day in Singapore.',
    postType: 'standard',
    createdAt: '2026-09-02T10:00:00.000Z',
    updatedAt: '2026-09-02T10:00:00.000Z',
    author: { id: '11111111-1111-4111-8111-111111111111', slug: 'member-a', fullName: 'Member A', avatarPath: null, headline: 'Chief Officer', rank: 'Chief Officer', currentCompany: 'Example Shipping' },
    media: null,
    mediaItems: [
      { id: mediaOne, storagePath: 'p/1.jpg', mimeType: 'image/jpeg', altText: 'Deck one', signedUrl: 'https://media.example/1.jpg', position: 0 },
      { id: mediaTwo, storagePath: 'p/2.jpg', mimeType: 'image/jpeg', altText: 'Deck two', signedUrl: 'https://media.example/2.jpg', position: 1 },
    ],
    poll: null,
    likeCount: 0,
    commentCount: 0,
    viewerLiked: false,
    viewerSaved: false,
    comments: [],
    ...overrides,
  }
}

afterEach(() => cleanup())

describe('PostCard: people tagged in photos (round 9B)', () => {
  it('shows "with <first name> and N others" under the media, linking the name and opening the full list', () => {
    render(<PostCard post={post({ photoTags: [priya, arjun, lee] })} />)

    const line = screen.getByTestId('post-photo-tags')
    expect(line).toHaveTextContent(/^with Priya Nair and 2 others$/)
    expect(line.querySelector('svg.lucide-users-round')).toBeInTheDocument()
    expect(within(line).getByRole('link', { name: 'Priya Nair' })).toHaveAttribute('href', '/people/priya-nair')
    // One truncated line on phones.
    expect(line).toHaveClass('truncate')

    fireEvent.click(within(line).getByRole('button', { name: '2 others' }))
    const dialog = screen.getByRole('dialog', { name: 'Tagged in this post' })
    const list = within(dialog).getByRole('list', { name: 'Tagged people' })
    expect(within(list).getAllByRole('link')).toHaveLength(3)
    expect(within(list).getByRole('link', { name: 'Priya Nair' })).toHaveAttribute('href', '/people/priya-nair')
    expect(within(list).getByRole('link', { name: 'Arjun Mehta' })).toHaveAttribute('href', '/people/arjun-mehta')
    expect(within(list).getByRole('link', { name: 'Officer Lee' })).toHaveAttribute('href', '/people/officer-lee')
  })

  it('counts a person once even when tagged in several photos, and drops "and others" for a single person', () => {
    const { unmount } = render(<PostCard post={post({ photoTags: [priya, { ...priya, mediaId: mediaTwo }, arjun] })} />)
    expect(screen.getByTestId('post-photo-tags')).toHaveTextContent(/^with Priya Nair and 1 other$/)
    unmount()

    render(<PostCard post={post({ photoTags: [lee] })} />)
    const line = screen.getByTestId('post-photo-tags')
    expect(line).toHaveTextContent(/^with Officer Lee$/)
    expect(within(line).queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders nothing when nobody is tagged, and shows the line for a repost’s original post', () => {
    const { unmount } = render(<PostCard post={post()} />)
    expect(screen.queryByTestId('post-photo-tags')).not.toBeInTheDocument()
    unmount()

    const original = post({ photoTags: [priya, arjun] })
    render(<PostCard post={post({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      postType: 'repost',
      body: '',
      mediaItems: [],
      repostOf: {
        id: original.id,
        category: original.category,
        body: original.body,
        postType: 'standard',
        createdAt: original.createdAt,
        updatedAt: original.updatedAt,
        author: original.author,
        media: null,
        mediaItems: original.mediaItems,
        poll: null,
        photoTags: original.photoTags,
      },
    })} />)
    const source = screen.getByRole('region', { name: 'Original post by Member A' })
    expect(within(source).getByTestId('post-photo-tags')).toHaveTextContent(/^with Priya Nair and 1 other$/)
  })
})
