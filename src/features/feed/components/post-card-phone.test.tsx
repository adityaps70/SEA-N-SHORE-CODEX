import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SHEET_MENU_ITEM_CLASS, SHEET_MENU_PANEL_CLASS } from '@/components/ui/mobile-sheet'
import type { FeedComment, FeedPost } from '../types'
import { PostCard, topComment } from './post-card'

const mocks = vi.hoisted(() => ({
  followProfile: vi.fn(async () => ({ ok: true as const }) as { ok: true } | { ok: false; error: string }),
}))

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
  updateComment: vi.fn(async () => ({ ok: true })),
  deleteComment: vi.fn(async () => ({ ok: true })),
}))

vi.mock('../mention-actions', () => ({ searchMentionCandidates: vi.fn(async () => []) }))

vi.mock('@/features/network/actions', () => ({
  followProfile: mocks.followProfile,
  unfollowProfile: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/features/moderation/actions', () => ({ reportContent: vi.fn(async () => ({ ok: true })) }))

const postId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const authorId = '11111111-1111-4111-8111-111111111111'

function comment(id: string, body: string, overrides: Partial<FeedComment> = {}): FeedComment {
  return {
    id,
    body,
    createdAt: '2026-09-02T11:00:00.000Z',
    author: { id: `author-${id}`, slug: `commenter-${id}`, fullName: `Commenter ${id.slice(0, 4)}`, avatarPath: null, headline: null, rank: 'Bosun', currentCompany: null },
    parentCommentId: null,
    viewerOwns: false,
    ...overrides,
  }
}

function post(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    id: postId,
    category: 'safety_lessons',
    body: 'Celebrating World Maritime Day.',
    postType: 'standard',
    createdAt: '2026-09-02T10:00:00.000Z',
    updatedAt: '2026-09-02T10:00:00.000Z',
    author: {
      id: authorId,
      slug: 'rinki',
      fullName: 'Rinki Mukharjee',
      avatarPath: null,
      headline: 'Community Relationship Manager',
      rank: null,
      currentCompany: null,
    },
    media: null,
    poll: null,
    likeCount: 4,
    reactionSummary: { like: 3, support: 1, respect: 0, on_point: 0 },
    commentCount: 0,
    viewerLiked: false,
    viewerSaved: false,
    viewerOwns: false,
    viewerFollowsAuthor: false,
    comments: [],
    ...overrides,
  }
}

const sheetPanelClasses = SHEET_MENU_PANEL_CLASS.split(' ')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PostCard phone header', () => {
  it('offers + Follow on phones for people the viewer does not follow, then hides it', async () => {
    render(<PostCard post={post()} flushOnPhones />)
    const follow = screen.getByRole('button', { name: 'Follow Rinki Mukharjee' })
    expect(follow).toHaveClass('md:hidden')

    fireEvent.click(follow)
    await waitFor(() => expect(mocks.followProfile).toHaveBeenCalledWith(authorId))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Follow Rinki Mukharjee' })).not.toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('You are now following Rinki Mukharjee.')
  })

  it('keeps the button when following fails', async () => {
    mocks.followProfile.mockResolvedValueOnce({ ok: false, error: 'This interaction is not available.' })
    render(<PostCard post={post()} flushOnPhones />)
    fireEvent.click(screen.getByRole('button', { name: 'Follow Rinki Mukharjee' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This interaction is not available.')
    expect(screen.getByRole('button', { name: 'Follow Rinki Mukharjee' })).toBeInTheDocument()
  })

  it.each([
    ['already followed', { viewerFollowsAuthor: true }],
    ['own post', { viewerOwns: true }],
    ['organization post', { organization: { id: 'org-1', slug: 'beaufort', name: 'Beaufort Marine', logoUrl: null } }],
    ['unknown follow state', { viewerFollowsAuthor: undefined }],
  ] as const)('shows no Follow button for an %s', (_label, overrides) => {
    render(<PostCard post={post(overrides as Partial<FeedPost>)} flushOnPhones />)
    expect(screen.queryByRole('button', { name: /^Follow / })).not.toBeInTheDocument()
  })

  it('shows no Follow button in read-only views', () => {
    render(<PostCard post={post()} readOnly flushOnPhones />)
    expect(screen.queryByRole('button', { name: /^Follow / })).not.toBeInTheDocument()
  })

  it('shows no Follow button in profile and organization post lists', () => {
    render(<PostCard post={post()} />)
    expect(screen.queryByRole('button', { name: /^Follow / })).not.toBeInTheDocument()
  })

  it('shows the time with a community globe on phones', () => {
    render(<PostCard post={post()} />)
    expect(screen.getByRole('img', { name: 'Visible to the Sea N Shore community' })).toHaveClass('md:hidden')
  })

  it('goes edge to edge on phones only when asked', () => {
    const { container, rerender } = render(<PostCard post={post()} flushOnPhones />)
    expect(container.firstElementChild).toHaveClass('max-md:rounded-none', 'max-md:border-x-0', 'max-md:shadow-none')
    rerender(<PostCard post={post({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })} />)
    expect(container.firstElementChild).not.toHaveClass('max-md:rounded-none')
  })
})

describe('PostCard phone counts and actions', () => {
  it('puts reactions and comments in a counts line above the action row', () => {
    render(<PostCard post={post({ commentCount: 1, comments: [comment('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Happy world maritime day')] })} />)
    const counts = screen.getByTestId('post-counts')
    expect(counts).toHaveClass('md:hidden')
    expect(within(counts).getByRole('button', { name: '4 reactions, see who reacted' })).toHaveTextContent('👍❤️4')
    expect(within(counts).getByRole('button', { name: '1 comment' })).toBeInTheDocument()
    // The in-button counts give way to the counts line on phones.
    expect(screen.getByTestId('reaction-count')).toHaveClass('max-md:hidden')
    expect(screen.getByTestId('comment-count')).toHaveClass('max-md:hidden')
    expect(screen.getByTestId('reaction-summary')).toHaveClass('max-md:hidden')
  })

  it('shows no counts line when nobody reacted or commented', () => {
    render(<PostCard post={post({ likeCount: 0, reactionSummary: { like: 0, support: 0, respect: 0, on_point: 0 } })} />)
    expect(screen.queryByTestId('post-counts')).not.toBeInTheDocument()
  })

  it('labels Like, Comment, Repost and Send on phones in four equal columns', () => {
    render(<PostCard post={post()} />)
    const row = screen.getByTestId('post-primary-actions')
    expect(row).toHaveClass('max-md:grid', 'max-md:grid-cols-4')
    for (const label of ['Like', 'Comment', 'Repost', 'Send']) {
      const text = within(row).getByText(label)
      expect(text).toHaveClass('max-md:inline')
      expect(text.closest('button')).toHaveClass('max-md:flex-col', 'max-md:min-h-13', 'max-md:border-0')
    }
  })
})

describe('PostCard phone top comment', () => {
  const older = comment('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'First!')
  const newest = comment('ffffffff-ffff-4fff-8fff-ffffffffffff', 'Happy world maritime day')
  const reply = comment('99999999-9999-4999-8999-999999999999', 'Thanks!', { parentCommentId: older.id })

  it('picks the newest top-level comment, as the thread shows first', () => {
    expect(topComment([older, newest, reply])).toBe(newest)
    expect(topComment([reply])).toBeNull()
    expect(topComment([{ ...newest, deleted: true }])).toBeNull()
  })

  it('previews one comment that opens the post and keeps the full thread for md and wider', () => {
    render(<PostCard post={post({ commentCount: 3, comments: [older, newest, reply] })} />)
    const preview = screen.getByTestId('top-comment-preview')
    expect(preview).toHaveClass('md:hidden')
    expect(preview).toHaveAttribute('href', `/posts/${postId}#comment-${newest.id}`)
    expect(preview).toHaveTextContent('Happy world maritime day')
    expect(document.getElementById(`comments-${postId}`)?.parentElement).toHaveClass('max-md:hidden')
  })

  it('shows the whole thread on phones once Comment is tapped', () => {
    render(<PostCard post={post({ commentCount: 1, comments: [newest] })} />)
    fireEvent.click(screen.getByRole('button', { name: '1 comment' }))
    expect(screen.queryByTestId('top-comment-preview')).not.toBeInTheDocument()
    expect(document.getElementById(`comments-${postId}`)?.parentElement).not.toHaveClass('max-md:hidden')
  })

  it('shows no preview on the post page', () => {
    render(<PostCard post={post({ commentCount: 1, comments: [newest] })} detail />)
    expect(screen.queryByTestId('top-comment-preview')).not.toBeInTheDocument()
  })
})

describe('PostCard menus as phone bottom sheets', () => {
  it('turns the post ⋯ menu into a bottom sheet with a grab handle, 52px rows and Cancel', () => {
    render(<PostCard post={post({ viewerFollowsAuthor: true })} />)
    const trigger = screen.getByRole('button', { name: 'Post options' })
    fireEvent.click(trigger)
    const menu = screen.getByRole('menu', { name: /options for rinki mukharjee's post/i })

    expect(menu).toHaveClass(...sheetPanelClasses)
    // On desktop the panel is a fixed, portaled dropdown so a card never clips it.
    expect(menu).toHaveClass('fixed', 'w-[min(18rem,calc(100vw-2rem))]')
    expect(menu.parentElement).toBe(document.body)
    for (const item of within(menu).getAllByRole('menuitem')) expect(item).toHaveClass(...SHEET_MENU_ITEM_CLASS.split(' '))
    expect(within(menu).getByRole('menuitem', { name: 'Report post' })).toHaveClass('text-red-700')

    fireEvent.click(within(menu).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes the post menu from the phone backdrop', () => {
    render(<PostCard post={post()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Post options' }))
    // The sheet and its backdrop are portaled to <body>.
    const backdrop = document.body.querySelector('.fixed.inset-0.md\\:hidden')
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop!)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('turns the Repost menu into a bottom sheet', () => {
    render(<PostCard post={post()} />)
    const trigger = screen.getByRole('button', { name: 'Repost' })
    fireEvent.click(trigger)
    const menu = screen.getByRole('menu', { name: 'Share post' })
    expect(menu).toHaveClass(...sheetPanelClasses)
    // Portaled and fixed; the side is measured from real layout (see action-menu.test.tsx).
    expect(menu).toHaveClass('fixed')
    expect(menu.parentElement).toBe(document.body)
    expect(within(menu).getByRole('menuitem', { name: 'Repost to feed' })).toHaveClass(...SHEET_MENU_ITEM_CLASS.split(' '))
    fireEvent.click(within(menu).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('turns the comment ⋯ menu into a bottom sheet', () => {
    render(<PostCard post={post({ commentCount: 1, comments: [comment('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Happy world maritime day')] })} detail />)
    const trigger = screen.getByRole('button', { name: 'Comment actions' })
    fireEvent.click(trigger)
    const menu = screen.getByRole('menu', { name: 'Comment actions' })
    expect(menu).toHaveClass(...sheetPanelClasses)
    expect(within(menu).getByRole('menuitem', { name: 'Report comment' })).toHaveClass(...SHEET_MENU_ITEM_CLASS.split(' '))
    fireEvent.click(within(menu).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('menu', { name: 'Comment actions' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
