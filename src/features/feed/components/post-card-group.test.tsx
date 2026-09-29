import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeedPost } from '../types'
import { PostCard } from './post-card'

const mocks = vi.hoisted(() => ({
  removeGroupPost: vi.fn(async () => ({ ok: true as const }) as { ok: true } | { ok: false; error: string }),
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
}))

vi.mock('@/features/network/actions', () => ({
  followProfile: vi.fn(async () => ({ ok: true })),
  unfollowProfile: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/features/community/actions', () => ({
  removeGroupPost: mocks.removeGroupPost,
}))

const postId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function post(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    id: postId,
    category: 'technical_discussion',
    body: 'Purifier vibration after the last overhaul: what would you check first?',
    postType: 'standard',
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
    author: { id: '11111111-1111-4111-8111-111111111111', slug: 'member-a', fullName: 'Member A', avatarPath: null, headline: 'Second Engineer', rank: 'Second Engineer', currentCompany: null },
    media: null,
    poll: null,
    likeCount: 0,
    commentCount: 0,
    viewerLiked: false,
    viewerSaved: false,
    viewerOwns: false,
    viewerFollowsAuthor: false,
    group: { id: '22222222-2222-4222-8222-222222222222', slug: 'marine-engineers', name: 'Marine Engineers', visibility: 'public' },
    comments: [],
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PostCard in a community group (round 9B)', () => {
  it('shows an "in <Group>" link in the header subline that opens the group page', () => {
    render(<PostCard post={post()} />)
    const link = screen.getByRole('link', { name: 'Posted in Marine Engineers' })
    expect(link).toHaveAttribute('href', '/community/marine-engineers')
    expect(link).toHaveTextContent('in Marine Engineers')
    // The label sits in the time / audience line, next to the globe.
    expect(link.parentElement).toContainElement(screen.getByRole('img', { name: 'Visible to the Sea N Shore community' }))
  })

  it('shows no group label for open-feed posts', () => {
    render(<PostCard post={post({ group: null })} />)
    expect(screen.queryByRole('link', { name: /Posted in/ })).not.toBeInTheDocument()
  })

  it('offers "Remove from group" only to group admins, and removes the post after confirming', async () => {
    render(<PostCard post={post({ viewerCanModerateGroup: true })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Post options' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent?.trim())).toEqual([
      'Save post', 'Copy link', 'Remove from group', 'Hide post', 'Report post',
    ])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Remove from group' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Remove this post from the group?' })
    expect(dialog).toHaveTextContent('It will be removed from Marine Engineers')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove from group' }))

    await waitFor(() => expect(mocks.removeGroupPost).toHaveBeenCalledWith(postId))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.queryByRole('link', { name: 'Posted in Marine Engineers' })).not.toBeInTheDocument()
  })

  it('keeps the post and shows the error when removal fails', async () => {
    mocks.removeGroupPost.mockResolvedValueOnce({ ok: false, error: 'Only the admins of this group can do that.' })
    render(<PostCard post={post({ viewerCanModerateGroup: true })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Post options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from group' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove from group' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Only the admins of this group can do that.'))
  })

  it('does not show "Remove from group" to plain members or when the viewer can already delete', () => {
    render(<PostCard post={post()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Post options' }))
    expect(screen.queryByRole('menuitem', { name: 'Remove from group' })).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    cleanup()

    render(<PostCard post={post({ viewerCanModerateGroup: true, viewerOwns: true })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Post options' }))
    expect(screen.queryByRole('menuitem', { name: 'Remove from group' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete post' })).toBeInTheDocument()
  })
})
