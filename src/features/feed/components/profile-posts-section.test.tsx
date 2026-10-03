import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeedPost } from '../types'
import { ProfilePostsSection } from './profile-posts-section'

vi.mock('./post-card', () => ({
  PostCard: ({ post }: { post: FeedPost }) => <article>{post.body}</article>,
}))

afterEach(cleanup)

const post: FeedPost = {
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
    avatarPath: null,
    avatarUrl: null,
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
  viewerOwns: false,
  comments: [],
}

describe('ProfilePostsSection', () => {
  it('renders a signed-in member activity section with real feed cards', () => {
    render(<ProfilePostsSection posts={[post]} ownerName="Captain Example" />)

    expect(screen.getByRole('heading', { name: 'Posts & activity' })).toBeInTheDocument()
    expect(screen.getByText('Shared a tanker safety lesson.')).toBeInTheDocument()
  })

  it('shows a clean empty state when the member has not posted yet', () => {
    render(<ProfilePostsSection posts={[]} ownerName="Captain Example" />)

    expect(screen.getByRole('heading', { name: 'Posts & activity' })).toBeInTheDocument()
    expect(screen.getByText('Captain Example has not shared any posts yet.')).toBeInTheDocument()
  })
})
