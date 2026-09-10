import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeedComment } from '../types'
import { CommentThread } from './comment-thread'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  addComment: vi.fn(async () => ({ ok: true as const })),
  updateComment: vi.fn(async () => ({ ok: true as const })),
  deleteComment: vi.fn(async () => ({ ok: true as const })),
  setCommentReaction: vi.fn(async () => ({ ok: true as const })),
  loadReactionDetails: vi.fn(async () => ({ ok: true as const, page: { reactors: [], nextCursor: null } })),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

vi.mock('../actions', () => ({
  addComment: mocks.addComment,
  updateComment: mocks.updateComment,
  deleteComment: mocks.deleteComment,
  setCommentReaction: mocks.setCommentReaction,
  loadReactionDetails: mocks.loadReactionDetails,
}))

vi.mock('../mention-actions', () => ({
  searchMentionCandidates: vi.fn(async () => []),
}))

const postId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const rootId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const replyOneId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const replyTwoId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const author = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'captain-member',
  fullName: 'Captain Member',
  avatarPath: null,
  avatarUrl: null,
  headline: 'Master Mariner',
  rank: 'Master',
  currentCompany: 'Sea N Shore',
}

function comment(overrides: Partial<FeedComment> = {}): FeedComment {
  return {
    id: rootId,
    body: 'Root discussion point.',
    createdAt: '2026-09-10T09:00:00.000Z',
    updatedAt: '2026-09-10T09:00:00.000Z',
    viewerOwns: false,
    canEdit: false,
    deleted: false,
    author,
    parentCommentId: null,
    reactionSummary: { like: 2, support: 1, respect: 0, on_point: 0 },
    reactionCount: 3,
    viewerReaction: null,
    mentions: [],
    ...overrides,
  }
}

function item(id: string) {
  const element = document.getElementById(`comment-${id}`)
  if (!element) throw new Error(`Missing comment ${id}`)
  return within(element)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CommentThread social metrics', () => {
  it('shows reaction symbols beside the total and a direct reply count on the root comment', () => {
    render(<CommentThread postId={postId} comments={[
      comment(),
      comment({ id: replyOneId, body: 'First reply.', parentCommentId: rootId, reactionSummary: { like: 1, support: 0, respect: 0, on_point: 0 }, reactionCount: 1 }),
      comment({ id: replyTwoId, body: 'Second reply.', parentCommentId: rootId, reactionSummary: { like: 0, support: 0, respect: 0, on_point: 0 }, reactionCount: 0 }),
    ]} />)

    const root = item(rootId)
    expect(root.getByRole('button', { name: /view comment reaction types/i })).toHaveTextContent('👍❤️')
    expect(root.getByRole('button', { name: /view 3 comment reactions/i })).toHaveTextContent('3 reactions')
    expect(root.getByLabelText('2 replies')).toHaveTextContent('2')
  })

  it('marks replies as connected thread rows and hides a zero reply metric on leaf replies', () => {
    render(<CommentThread postId={postId} comments={[
      comment(),
      comment({ id: replyOneId, body: 'First reply.', parentCommentId: rootId }),
    ]} />)

    expect(screen.getByTestId(`reply-thread-${replyOneId}`)).toBeInTheDocument()
    expect(item(replyOneId).queryByLabelText('0 replies')).not.toBeInTheDocument()
  })
})
