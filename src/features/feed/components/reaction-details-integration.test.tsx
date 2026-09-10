import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeedComment, FeedPost } from '../types'
import { CommentThread } from './comment-thread'
import { PostCard } from './post-card'

const mocks = vi.hoisted(() => ({
  loadReactionDetails: vi.fn(async () => ({ ok: true as const, page: { reactors: [], nextCursor: null } })),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

vi.mock('../actions', () => ({
  loadReactionDetails: mocks.loadReactionDetails,
  deletePost: vi.fn(async () => ({ ok: true })),
  setPostReaction: vi.fn(async () => ({ ok: true })),
  setPostSaved: vi.fn(async () => ({ ok: true })),
  setCommentReaction: vi.fn(async () => ({ ok: true })),
  setPollVote: vi.fn(async () => ({ ok: true })),
  addComment: vi.fn(async () => ({ ok: true })),
}))

vi.mock('../mention-actions', () => ({
  searchMentionCandidates: vi.fn(async () => []),
}))

const author = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'captain-a',
  fullName: 'Captain A',
  avatarPath: null,
  avatarUrl: null,
  headline: 'Master Mariner',
  rank: 'Master',
  currentCompany: 'Oceanic Shipping',
}

const post: FeedPost = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  category: 'technical_discussion',
  body: 'Useful tanker safety point.',
  postType: 'standard',
  createdAt: '2026-09-10T09:00:00.000Z',
  updatedAt: '2026-09-10T09:00:00.000Z',
  author,
  media: null,
  poll: null,
  reactionSummary: { like: 2, support: 1, respect: 0, on_point: 0 },
  reactionCount: 3,
  viewerReaction: null,
  likeCount: 2,
  viewerLiked: false,
  commentCount: 0,
  viewerSaved: false,
  comments: [],
}

const comment: FeedComment = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  body: 'Agreed.',
  createdAt: '2026-09-10T09:05:00.000Z',
  author,
  parentCommentId: null,
  reactionSummary: { like: 1, support: 0, respect: 0, on_point: 1 },
  reactionCount: 2,
  viewerReaction: null,
  mentions: [],
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('reaction detail feed integration', () => {
  it('opens lazy reactor details from the post reaction summary', async () => {
    render(<PostCard post={post} />)

    fireEvent.click(screen.getByRole('button', { name: /view 3 reactions/i }))

    expect(screen.getByRole('dialog', { name: /reactions/i })).toBeInTheDocument()
    await waitFor(() => expect(mocks.loadReactionDetails).toHaveBeenCalledWith({
      targetType: 'post',
      targetId: post.id,
      limit: 30,
    }))
  })

  it('opens lazy reactor details from a comment reaction count', async () => {
    render(<CommentThread postId={post.id} comments={[comment]} />)

    fireEvent.click(screen.getByRole('button', { name: /view 2 comment reactions/i }))

    expect(screen.getByRole('dialog', { name: /reactions/i })).toBeInTheDocument()
    await waitFor(() => expect(mocks.loadReactionDetails).toHaveBeenCalledWith({
      targetType: 'comment',
      targetId: comment.id,
      limit: 30,
    }))
  })
})
