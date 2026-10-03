import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedPost } from '../types'
import { PostCard } from './post-card'

const mocks = vi.hoisted(() => ({
  pathname: '/home',
  setPostHidden: vi.fn<(postId: string, hidden: boolean) => Promise<{ ok: true } | { ok: false; error: string }>>(async () => ({ ok: true })),
  setPostSaved: vi.fn(async () => ({ ok: true as const })),
  deletePost: vi.fn(async () => ({ ok: true as const })),
  followProfile: vi.fn(async () => ({ ok: true as const })),
  unfollowProfile: vi.fn(async () => ({ ok: true as const }) as { ok: true } | { ok: false; error: string }),
  reportContent: vi.fn(async () => ({ ok: true as const })),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => mocks.pathname,
}))

vi.mock('../actions', () => ({
  loadReactionDetails: vi.fn(async () => ({ ok: true, page: { reactors: [], nextCursor: null } })),
  deletePost: mocks.deletePost,
  repostPost: vi.fn(async () => ({ ok: true, postId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })),
  setPostReaction: vi.fn(async () => ({ ok: true })),
  setPostSaved: mocks.setPostSaved,
  setPostHidden: mocks.setPostHidden,
  setCommentReaction: vi.fn(async () => ({ ok: true })),
  setPollVote: vi.fn(async () => ({ ok: true })),
  addComment: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/features/network/actions', () => ({
  followProfile: mocks.followProfile,
  unfollowProfile: mocks.unfollowProfile,
}))

vi.mock('@/features/moderation/actions', () => ({
  reportContent: mocks.reportContent,
}))

const postId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const authorId = '11111111-1111-4111-8111-111111111111'

function post(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    id: postId,
    category: 'safety_lessons',
    body: 'Enclosed space entry checklist from last week’s drill.',
    postType: 'standard',
    createdAt: '2026-09-02T10:00:00.000Z',
    updatedAt: '2026-09-02T10:00:00.000Z',
    author: {
      id: authorId,
      slug: 'member-a',
      fullName: 'Member A',
      avatarPath: null,
      headline: 'Chief Officer',
      rank: 'Chief Officer',
      currentCompany: 'Example Shipping',
    },
    media: null,
    poll: null,
    likeCount: 0,
    commentCount: 0,
    viewerLiked: false,
    viewerSaved: false,
    viewerOwns: false,
    viewerFollowsAuthor: true,
    comments: [],
    ...overrides,
  }
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Post options' }))
  return screen.getByRole('menu', { name: /options for member a's post/i })
}

beforeEach(() => {
  mocks.pathname = '/home'
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.setPostHidden.mockResolvedValue({ ok: true })
  mocks.unfollowProfile.mockResolvedValue({ ok: true })
})

describe('PostCard ⋯ menu', () => {
  it('lists Save, Copy link, Hide, Unfollow and Report for another member’s post, and no Delete', () => {
    render(<PostCard post={post()} />)
    const menu = openMenu()
    const labels = within(menu).getAllByRole('menuitem').map((item) => item.textContent?.trim())
    expect(labels).toEqual(['Save post', 'Copy link', 'Hide post', 'Unfollow Member A', 'Report post'])
    expect(within(menu).queryByRole('menuitem', { name: /delete/i })).not.toBeInTheDocument()
  })

  it('hides Unfollow when the viewer does not follow the author', () => {
    render(<PostCard post={post({ viewerFollowsAuthor: false })} />)
    const menu = openMenu()
    expect(within(menu).queryByRole('menuitem', { name: /unfollow/i })).not.toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Hide post' })).toBeInTheDocument()
  })

  it('shows only Save, Copy link, Edit and Delete on the viewer’s own post', () => {
    render(<PostCard post={post({ viewerOwns: true, viewerFollowsAuthor: false })} />)
    const menu = openMenu()
    const labels = within(menu).getAllByRole('menuitem').map((item) => item.textContent?.trim())
    expect(labels).toEqual(['Save post', 'Copy link', 'Edit post', 'Delete post'])
  })

  it('is not rendered for signed-out, read-only views', () => {
    render(<PostCard post={post()} readOnly />)
    expect(screen.queryByRole('button', { name: 'Post options' })).not.toBeInTheDocument()
  })

  it('closes on Escape and returns focus to the trigger, on outside click, and on route change', () => {
    const { rerender } = render(<PostCard post={post()} />)
    const trigger = screen.getByRole('button', { name: 'Post options' })

    openMenu()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    openMenu()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    openMenu()
    mocks.pathname = '/network'
    rerender(<PostCard post={post()} />)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('moves between menu items with the arrow keys', () => {
    render(<PostCard post={post()} />)
    const menu = openMenu()
    const items = within(menu).getAllByRole('menuitem')
    expect(items[0]).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(items[1]).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(items[items.length - 1]).toHaveFocus()
  })

  it('hides the post for this viewer and restores it with Undo', async () => {
    render(<PostCard post={post()} />)
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Hide post' }))

    await waitFor(() => expect(mocks.setPostHidden).toHaveBeenCalledWith(postId, true))
    expect(await screen.findByText('Post hidden')).toBeInTheDocument()
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    expect(screen.getByText(/won.t see this post from Member A in your feed/i)).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(mocks.setPostHidden).toHaveBeenLastCalledWith(postId, false))
    expect(await screen.findByRole('article')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Post restored to your feed.')
  })

  it('keeps the post and explains the failure when hiding fails', async () => {
    mocks.setPostHidden.mockResolvedValueOnce({ ok: false, error: 'We could not hide this post. Please try again.' })
    render(<PostCard post={post()} />)
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Hide post' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not hide this post. Please try again.')
    expect(screen.getByRole('article')).toBeInTheDocument()
  })

  it('copies the post link and confirms it visibly', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<PostCard post={post()} />)
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Copy link' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/posts/${postId}`))
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/link copied/i)
    expect(status).toBeVisible()
  })

  it('shows the link to copy by hand when the clipboard is blocked', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => { throw new Error('denied') }) } })
    render(<PostCard post={post()} />)
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Copy link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(`/posts/${postId}`)
  })

  it('saves from the menu with a confirmation and a link to saved posts', async () => {
    render(<PostCard post={post()} />)
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Save post' }))
    await waitFor(() => expect(mocks.setPostSaved).toHaveBeenCalledWith(postId, true))
    expect(await screen.findByRole('status')).toHaveTextContent('Post saved.')
    expect(screen.getByRole('link', { name: 'View saved posts' })).toHaveAttribute('href', '/saved')
    expect(within(openMenu()).getByRole('menuitem', { name: 'Remove from saved' })).toBeInTheDocument()
  })

  it('unfollows through the follow system and offers Undo', async () => {
    render(<PostCard post={post()} />)
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Unfollow Member A' }))
    await waitFor(() => expect(mocks.unfollowProfile).toHaveBeenCalledWith(authorId))
    expect(await screen.findByRole('status')).toHaveTextContent('You unfollowed Member A.')
    expect(within(openMenu()).queryByRole('menuitem', { name: /unfollow/i })).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

    const undo = await screen.findByRole('button', { name: 'Undo' })
    await act(async () => { fireEvent.click(undo) })
    await waitFor(() => expect(mocks.followProfile).toHaveBeenCalledWith(authorId))
    expect(await screen.findByText('You are following Member A again.')).toBeInTheDocument()
  })

  it('reports an unfollow failure without changing the menu', async () => {
    mocks.unfollowProfile.mockResolvedValueOnce({ ok: false, error: 'This interaction is not available.' })
    render(<PostCard post={post()} />)
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Unfollow Member A' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This interaction is not available.')
    expect(within(openMenu()).getByRole('menuitem', { name: 'Unfollow Member A' })).toBeInTheDocument()
  })

  it('opens the existing report form from the menu', async () => {
    render(<PostCard post={post()} />)
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Report post' }))
    const dialog = screen.getByRole('dialog', { name: 'Report post' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit report' }))
    await waitFor(() => expect(mocks.reportContent).toHaveBeenCalledWith(expect.objectContaining({ targetType: 'post', targetId: postId })))
    expect(await within(dialog).findByText('Report submitted for review.')).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled())
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Report post' })).not.toBeInTheDocument()
  })
})
