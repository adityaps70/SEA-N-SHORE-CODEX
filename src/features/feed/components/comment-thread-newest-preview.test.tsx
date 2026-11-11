import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  loadAllPostComments: vi.fn(),
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
  loadAllPostComments: mocks.loadAllPostComments,
}))

vi.mock('../mention-actions', () => ({
  searchMentionCandidates: vi.fn(async () => []),
}))

const postId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const rootId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

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


// Round DB (Deploy C): company, group, hashtag and recent feed pages load only the comments a post card shows first
// (the newest top-level comment with its replies, plus the post's top-level count). The card must read exactly as it
// did with every comment loaded, and "View N more comments" must reveal exactly what it revealed before.
const id = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const at = (n: number) => `2026-11-01T00:${String(n).padStart(2, '0')}:00.000Z`
const FULL: FeedComment[] = [
  comment({ id: id(1), body: 'Oldest point.', createdAt: at(1) }),
  comment({ id: id(2), body: 'Reply to the oldest.', parentCommentId: id(1), createdAt: at(2) }),
  comment({ id: id(3), body: 'Middle point.', createdAt: at(3) }),
  comment({ id: id(4), body: 'Newest point.', createdAt: at(4) }),
  comment({ id: id(5), body: 'First reply to the newest.', parentCommentId: id(4), createdAt: at(5) }),
  comment({ id: id(6), body: 'Second reply to the newest.', parentCommentId: id(4), createdAt: at(6) }),
]
// What getNewestCommentPreview loads for that post: the newest top-level comment and its replies.
const PREVIEW = FULL.filter((c) => c.id === id(4) || c.parentCommentId === id(4))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CommentThread with the newest comments preview', () => {
  it('reads exactly as with every comment loaded, and "View 2 more comments" reveals the same comments', async () => {
    const full = render(<CommentThread postId={postId} comments={FULL} totalCount={FULL.length} />)
    const fullText = full.container.textContent
    fireEvent.click(screen.getByRole('button', { name: 'View 2 more comments' }))
    const fullExpanded = full.container.textContent
    full.unmount()

    mocks.loadAllPostComments.mockResolvedValueOnce({ ok: true, comments: FULL })
    const preview = render(<CommentThread postId={postId} comments={PREVIEW} totalCount={FULL.length} commentsComplete={false} rootCount={3} />)
    expect(preview.container.textContent).toBe(fullText)
    expect(fullText).toContain('Newest point.')
    expect(fullText).not.toContain('Oldest point.')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'View 2 more comments' })) })
    await waitFor(() => expect(mocks.loadAllPostComments).toHaveBeenCalledWith(postId))
    await waitFor(() => expect(preview.container.textContent).toBe(fullExpanded))
    expect(fullExpanded).toContain('Oldest point.')
  })

  it('a post with one top-level comment is complete in the preview and reads the same', () => {
    const single = FULL.filter((c) => c.id === id(4) || c.parentCommentId === id(4))
    const full = render(<CommentThread postId={postId} comments={single} totalCount={single.length} />)
    const fullText = full.container.textContent
    full.unmount()
    const preview = render(<CommentThread postId={postId} comments={single} totalCount={single.length} commentsComplete rootCount={1} />)
    expect(preview.container.textContent).toBe(fullText)
    expect(screen.queryByRole('button', { name: /more comment|view all/i })).not.toBeInTheDocument()
  })
})
