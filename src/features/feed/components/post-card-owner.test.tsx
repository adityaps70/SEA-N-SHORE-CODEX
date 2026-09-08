import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
})

describe('PostCard owner controls', () => {
  it('renders the signed profile photo instead of initials when one exists', () => {
    render(<PostCard post={post()} />)

    expect(screen.getByRole('img', { name: "Captain Example's profile photo" })).toHaveAttribute('src', 'https://signed.example/avatar.webp')
  })

  it('shows delete only to the original author and removes the card after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { rerender } = render(<PostCard post={post()} />)

    fireEvent.click(screen.getByRole('button', { name: /delete post/i }))

    await waitFor(() => expect(mockedDeletePost).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))
    await waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument())

    rerender(<PostCard post={post({ viewerOwns: false })} />)
    expect(screen.queryByRole('button', { name: /delete post/i })).not.toBeInTheDocument()
  })
})
