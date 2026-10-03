import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeedPost } from '../types'
import { deletePost, setPostLiked, setPostSaved } from '../actions'
import { PostCard } from './post-card'

vi.mock('../actions', () => ({
  setPostLiked: vi.fn(async () => ({ ok: true })),
  setPostSaved: vi.fn(async () => ({ ok: true })),
  setPollVote: vi.fn(async () => ({ ok: true })),
  addComment: vi.fn(async () => ({ ok: true })),
  deletePost: vi.fn(async () => ({ ok: true })),
}))

const mockedDeletePost = vi.mocked(deletePost)
void setPostLiked
void setPostSaved

function post(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    category: 'learning',
    body: 'Shared a tanker safety lesson.',
    postType: 'standard',
    createdAt: '2026-09-09T10:00:00.000Z',
    updatedAt: '2026-09-09T10:00:00.000Z',
    author: {
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'captain-example',
      fullName: 'Captain Example',
      avatarPath: 'profiles/member/avatar.webp',
      avatarUrl: 'https://signed.example/avatar.webp',
      headline: 'Master Mariner',
      rank: 'Master',
      currentCompany: 'Example Shipping',
    },
    media: null,
    poll: null,
    likeCount: 0,
    commentCount: 0,
    viewerLiked: false,
    viewerSaved: false,
    viewerOwns: true,
    comments: [],
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  mockedDeletePost.mockClear()
})

describe('PostCard owner controls', () => {
  it('renders the signed profile photo instead of initials when one exists', () => {
    render(<PostCard post={post()} />)

    expect(screen.getByRole('img', { name: "Captain Example's profile photo" })).toHaveAttribute('src', 'https://signed.example/avatar.webp')
  })

  it('offers Delete only to the original author in the post menu and deletes after an in-page confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    const { rerender } = render(<PostCard post={post()} />)

    expect(screen.queryByRole('button', { name: /delete post/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Post options' }))
    expect(screen.queryByRole('menuitem', { name: /hide post/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /report post/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: /delete post/i }))

    const dialog = screen.getByRole('alertdialog', { name: 'Delete this post?' })
    expect(dialog).toHaveTextContent(/restore it .* for 30 days/i)
    expect(mockedDeletePost).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete post' }))

    await waitFor(() => expect(mockedDeletePost).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))
    await waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('Post deleted.')
    expect(screen.getByRole('link', { name: 'Recently deleted' })).toHaveAttribute('href', '/activities?tab=deleted')
    expect(confirmSpy).not.toHaveBeenCalled()

    rerender(<PostCard key="other" post={post({ viewerOwns: false })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Post options' }))
    expect(screen.queryByRole('menuitem', { name: /delete post/i })).not.toBeInTheDocument()
  })

  it('keeps the post when the delete confirmation is cancelled or dismissed with Escape', () => {
    render(<PostCard post={post()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Post options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /delete post/i }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Post options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /delete post/i }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(mockedDeletePost).not.toHaveBeenCalled()
    expect(screen.getByRole('article')).toBeInTheDocument()
  })

  it('shows the delete failure inside the confirmation instead of closing it', async () => {
    mockedDeletePost.mockResolvedValueOnce({ ok: false, error: 'We could not delete this post.' })
    render(<PostCard post={post()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Post options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /delete post/i }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete post' }))
    expect(await within(screen.getByRole('alertdialog')).findByRole('alert')).toHaveTextContent('We could not delete this post. Please try again.')
    expect(screen.getByRole('article')).toBeInTheDocument()
  })
})
