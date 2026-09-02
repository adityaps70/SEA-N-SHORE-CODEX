import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FeedPost } from '../types'
import { PostCard } from './post-card'

vi.mock('../actions', () => ({
  setPostLiked: vi.fn(async () => ({ ok: true })),
  setPostSaved: vi.fn(async () => ({ ok: true })),
  setPollVote: vi.fn(async () => ({ ok: true })),
  addComment: vi.fn(async () => ({ ok: true })),
}))

const post: FeedPost = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  category: 'achievement',
  body: 'Completed my advanced tanker training today.',
  postType: 'standard',
  createdAt: '2026-09-02T10:00:00.000Z',
  updatedAt: '2026-09-02T10:00:00.000Z',
  author: {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'member-a',
    fullName: 'Member A',
    avatarPath: null,
    headline: 'Chief Officer | Tankers',
    rank: 'Chief Officer',
    currentCompany: 'Example Shipping',
  },
  media: null,
  poll: null,
  likeCount: 4,
  commentCount: 2,
  viewerLiked: false,
  viewerSaved: false,
  comments: [],
}

describe('PostCard', () => {
  it('renders a semantic post with real controls and counts', () => {
    render(<PostCard post={post} />)
    expect(screen.getByRole('article')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Member A' })).toHaveAttribute('href', '/people/member-a')
    expect(screen.getByText('Achievement')).toBeInTheDocument()
    expect(screen.getByText('4 likes')).toBeInTheDocument()
    expect(screen.getByText('2 comments')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Like/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Comment/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Share/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save/i })).toBeInTheDocument()
    expect(screen.getByText((_, element) => element?.tagName === 'TIME')).toHaveAttribute('datetime', post.createdAt)
    expect(screen.queryByText(/Verified/i)).not.toBeInTheDocument()
  })
})
