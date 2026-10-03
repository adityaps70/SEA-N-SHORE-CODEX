import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedMedia, FeedPost } from '@/features/feed/types'
import { savedPostLabel, savedPostPreview } from './saved-post-preview'
import { SavedPostsGrid } from './saved-posts-grid'

const mocks = vi.hoisted(() => ({
  setPostSaved: vi.fn(async () => ({ ok: true as const })),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/saved',
}))

vi.mock('@/features/feed/actions', () => ({
  loadReactionDetails: vi.fn(async () => ({ ok: true, page: { reactors: [], nextCursor: null } })),
  deletePost: vi.fn(async () => ({ ok: true })),
  repostPost: vi.fn(async () => ({ ok: true, postId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })),
  setPostReaction: vi.fn(async () => ({ ok: true })),
  setPostSaved: mocks.setPostSaved,
  setPostHidden: vi.fn(async () => ({ ok: true })),
  setCommentReaction: vi.fn(async () => ({ ok: true })),
  setPollVote: vi.fn(async () => ({ ok: true })),
  addComment: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/features/network/actions', () => ({
  followProfile: vi.fn(async () => ({ ok: true })),
  unfollowProfile: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/features/moderation/actions', () => ({ reportContent: vi.fn(async () => ({ ok: true })) }))

function media(overrides: Partial<FeedMedia> = {}): FeedMedia {
  return {
    storagePath: 'posts/one.jpg',
    mimeType: 'image/jpeg',
    altText: 'Bridge at dawn',
    signedUrl: 'https://media.example.com/one.jpg',
    position: 0,
    ...overrides,
  }
}

function post(id: string, overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    id,
    category: 'safety_lessons',
    body: 'Enclosed space entry checklist from last week’s drill.',
    postType: 'standard',
    createdAt: '2026-09-02T10:00:00.000Z',
    updatedAt: '2026-09-02T10:00:00.000Z',
    author: {
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'capt-rao',
      fullName: 'Capt. Rao',
      avatarPath: null,
      headline: 'Master Mariner',
      rank: 'Master',
      currentCompany: 'Example Shipping',
    },
    media: null,
    poll: null,
    likeCount: 0,
    commentCount: 0,
    viewerLiked: false,
    viewerSaved: true,
    viewerOwns: false,
    viewerFollowsAuthor: true,
    comments: [],
    ...overrides,
  }
}

const textPost = post('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
const photoPost = post('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
  body: 'Sunrise in the Malacca Strait',
  mediaItems: [media({ position: 1, storagePath: 'posts/two.jpg', signedUrl: 'https://media.example.com/two.jpg' }), media()],
})
const videoPost = post('cccccccc-cccc-4ccc-8ccc-cccccccccccc', {
  body: 'Mooring operation',
  media: media({ mimeType: 'video/mp4', storagePath: 'posts/moor.mp4', signedUrl: 'https://media.example.com/moor.mp4', altText: null }),
})
const pollPost = post('dddddddd-dddd-4ddd-8ddd-dddddddddddd', {
  body: 'Which ECDIS do you prefer?',
  postType: 'poll',
  poll: { options: [{ id: 'o1', label: 'A', position: 0, voteCount: 1 }], totalVotes: 1, viewerOptionId: null },
})
const documentPost = post('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', {
  body: '',
  media: media({ mimeType: 'application/pdf', storagePath: 'posts/sms.pdf', signedUrl: 'https://media.example.com/sms.pdf', fileName: 'SMS manual.pdf', pageCount: 4 }),
})

beforeEach(() => {
  vi.clearAllMocks()
  document.body.style.overflow = ''
})
afterEach(() => cleanup())

describe('savedPostPreview', () => {
  it('uses the first photo by position and counts every attachment', () => {
    const preview = savedPostPreview(photoPost)
    expect(preview).toMatchObject({ kind: 'image', mediaUrl: 'https://media.example.com/one.jpg', mediaCount: 2, hasPoll: false })
    expect(savedPostLabel(preview)).toBe('Open saved post by Capt. Rao (2 photos or videos): Sunrise in the Malacca Strait')
  })

  it('marks videos, documents, polls and plain text posts', () => {
    expect(savedPostPreview(videoPost)).toMatchObject({ kind: 'video', mediaUrl: 'https://media.example.com/moor.mp4' })
    expect(savedPostPreview(documentPost)).toMatchObject({ kind: 'document', documentName: 'SMS manual', mediaUrl: null })
    expect(savedPostPreview(pollPost)).toMatchObject({ kind: 'text', hasPoll: true })
    expect(savedPostPreview(textPost)).toMatchObject({ kind: 'text', text: textPost.body, mediaCount: 0 })
  })

  it('previews the original post for a repost without its own words or media', () => {
    const repost = post('ffffffff-ffff-4fff-8fff-ffffffffffff', {
      body: '',
      postType: 'repost',
      repostOf: {
        id: photoPost.id,
        category: 'safety_lessons',
        body: 'Original crossing notes',
        postType: 'standard',
        createdAt: photoPost.createdAt,
        updatedAt: photoPost.updatedAt,
        author: photoPost.author,
        media: media(),
        poll: null,
      },
    })
    expect(savedPostPreview(repost)).toMatchObject({ kind: 'image', text: 'Original crossing notes', isRepost: true })
  })

  it('shortens long text in the tile label', () => {
    const long = savedPostPreview(post('abababab-abab-4bab-8bab-abababababab', { body: 'x'.repeat(200) }))
    expect(savedPostLabel(long).length).toBeLessThan(140)
    expect(savedPostLabel(long).endsWith('…')).toBe(true)
  })
})

describe('SavedPostsGrid', () => {
  it('renders a three-column grid of square tiles with media, text and corner badges', () => {
    render(<SavedPostsGrid posts={[textPost, photoPost, videoPost, pollPost, documentPost]} />)

    const grid = screen.getByRole('list', { name: 'Saved posts' })
    expect(grid).toHaveClass('grid-cols-3')
    const tiles = within(grid).getAllByRole('button')
    expect(tiles).toHaveLength(5)
    for (const tile of tiles) expect(tile).toHaveClass('aspect-square')

    expect(tiles[0]).toHaveTextContent(textPost.body)
    expect(tiles[1]?.querySelector('img')).toHaveAttribute('src', 'https://media.example.com/one.jpg')
    expect(tiles[1]?.querySelector('svg.lucide-copy')).not.toBeNull()
    expect(tiles[2]?.querySelector('video')).toHaveAttribute('src', 'https://media.example.com/moor.mp4#t=0.1')
    expect(tiles[2]?.querySelector('svg.lucide-play')).not.toBeNull()
    expect(tiles[3]?.querySelector('svg[class*="lucide-chart"]')).not.toBeNull()
    expect(tiles[4]).toHaveTextContent('SMS manual')
    expect(tiles[4]?.querySelector('[data-testid="tile-badges"] svg.lucide-file-text')).not.toBeNull()
    expect(tiles[0]?.querySelector('[data-testid="tile-badges"]')).toBeNull()
    // The full post is not rendered in the grid itself.
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })

  it('opens the full post in a dialog and closes it with the X button, Escape and the backdrop', () => {
    render(<SavedPostsGrid posts={[textPost, photoPost]} />)
    const tile = screen.getByRole('button', { name: /Open saved post by Capt\. Rao \(2 photos/ })

    fireEvent.click(tile)
    let dialog = screen.getByRole('dialog', { name: 'Saved post by Capt. Rao' })
    expect(within(dialog).getByRole('article')).toBeInTheDocument()
    expect(within(dialog).getByText('Sunrise in the Malacca Strait')).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')
    expect(within(dialog).getByRole('button', { name: 'Close saved post' })).toHaveFocus()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close saved post' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')

    fireEvent.click(tile)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(tile)
    dialog = screen.getByRole('dialog')
    fireEvent.mouseDown(dialog.parentElement as HTMLElement)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('lets Escape close the post menu first, without closing the dialog', () => {
    render(<SavedPostsGrid posts={[textPost]} />)
    fireEvent.click(screen.getByRole('button', { name: /Open saved post/ }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Post options' }))
    // The post menu is portaled to <body>, outside the dialog panel.
    const menu = screen.getByRole('menu')

    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('keeps Unsave working inside the dialog and keeps the post open after the grid refreshes', async () => {
    const { rerender } = render(<SavedPostsGrid posts={[textPost, photoPost]} />)
    fireEvent.click(screen.getByRole('button', { name: /Open saved post by Capt\. Rao: Enclosed/ }))
    const dialog = screen.getByRole('dialog')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Post options' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from saved' }))
    })

    expect(mocks.setPostSaved).toHaveBeenCalledWith(textPost.id, false)
    await waitFor(() => expect(within(dialog).getByText('Removed from your saved posts.')).toBeInTheDocument())

    // The server refresh drops the unsaved post from the grid; the open dialog keeps showing it.
    rerender(<SavedPostsGrid posts={[photoPost]} />)
    expect(screen.getAllByRole('button', { name: /Open saved post/ })).toHaveLength(1)
    expect(screen.getByRole('dialog')).toHaveTextContent(textPost.body)
  })

  it('opens tiles from the keyboard because every tile is a real button', () => {
    render(<SavedPostsGrid posts={[textPost]} />)
    const tile = screen.getByRole('button', { name: /Open saved post/ })
    expect(tile.tagName).toBe('BUTTON')
    expect(tile).toHaveAttribute('aria-haspopup', 'dialog')
  })
})
