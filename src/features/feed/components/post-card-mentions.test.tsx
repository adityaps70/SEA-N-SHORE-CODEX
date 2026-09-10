import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeedPost } from '../types'
import { PostCard } from './post-card'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock('../actions', () => ({
  deletePost: vi.fn(async () => ({ ok: true })),
  setPostReaction: vi.fn(async () => ({ ok: true })),
  setPostSaved: vi.fn(async () => ({ ok: true })),
  setCommentReaction: vi.fn(async () => ({ ok: true })),
  setPollVote: vi.fn(async () => ({ ok: true })),
  addComment: vi.fn(async () => ({ ok: true })),
}))

const post: FeedPost = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  category: 'technical_discussion',
  body: 'Thanks @Rahul Gupta for the tanker safety insight.',
  postType: 'standard',
  createdAt: '2026-09-10T06:00:00.000Z',
  updatedAt: '2026-09-10T06:00:00.000Z',
  author: {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'member-a',
    fullName: 'Member A',
    avatarPath: null,
    avatarUrl: null,
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
  mentions: [{
    profileId: '22222222-2222-4222-8222-222222222222',
    slug: 'rahul-gupta',
    fullName: 'Rahul Gupta',
  }],
  comments: [],
}

afterEach(() => cleanup())

describe('PostCard mention rendering', () => {
  it('renders a stored mention as a highlighted profile link inside post body', () => {
    render(<PostCard post={post} readOnly />)

    const mention = screen.getByRole('link', { name: '@Rahul Gupta' })
    expect(mention).toHaveAttribute('href', '/people/rahul-gupta')
    expect(mention).toHaveClass('text-ocean-700')
  })
})
