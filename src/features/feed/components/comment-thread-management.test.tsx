import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  searchMentionCandidates: vi.fn(async () => ([{
    id: '44444444-4444-4444-8444-444444444444',
    slug: 'rahul-gupta',
    fullName: 'Rahul Gupta',
    avatarUrl: null,
    headline: 'Master Mariner',
    rank: 'Captain',
    currentCompany: 'Sea N Shore',
  }])),
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
  searchMentionCandidates: mocks.searchMentionCandidates,
}))

const postId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const rootId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const replyId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const otherId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const viewerAuthor = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'viewer',
  fullName: 'Viewer Member',
  avatarPath: null,
  avatarUrl: null,
  headline: 'Chief Officer',
  rank: 'Chief Officer',
  currentCompany: 'Example Shipping',
}

const otherAuthor = {
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'other-member',
  fullName: 'Other Member',
  avatarPath: null,
  avatarUrl: null,
  headline: 'Master Mariner',
  rank: 'Master',
  currentCompany: 'Oceanic Shipping',
}

function comment(overrides: Partial<FeedComment> = {}): FeedComment {
  return {
    id: rootId,
    body: 'Useful point.',
    createdAt: '2026-09-10T09:00:00.000Z',
    updatedAt: '2026-09-10T09:00:00.000Z',
    viewerOwns: true,
    canEdit: true,
    deleted: false,
    author: viewerAuthor,
    parentCommentId: null,
    reactionSummary: { like: 0, support: 0, respect: 0, on_point: 0 },
    reactionCount: 0,
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
  mocks.addComment.mockResolvedValue({ ok: true })
  mocks.updateComment.mockResolvedValue({ ok: true })
  mocks.deleteComment.mockResolvedValue({ ok: true })
  mocks.setCommentReaction.mockResolvedValue({ ok: true })
})

describe('CommentThread management', () => {
  it('shows owner menus on comments and replies, hides them from non-owners, and gates Edit by canEdit only', async () => {
    const user = userEvent.setup()
    const ownedRoot = comment()
    const ownedExpiredReply = comment({
      id: replyId,
      body: 'Older reply.',
      parentCommentId: rootId,
      canEdit: false,
    })
    const nonOwnerReply = comment({
      id: otherId,
      body: 'Another reply.',
      parentCommentId: rootId,
      viewerOwns: false,
      canEdit: false,
      author: otherAuthor,
    })

    render(<CommentThread postId={postId} comments={[ownedRoot, ownedExpiredReply, nonOwnerReply]} />)

    expect(item(rootId).getByRole('button', { name: /comment actions/i })).toBeInTheDocument()
    expect(item(replyId).getByRole('button', { name: /comment actions/i })).toBeInTheDocument()
    expect(item(otherId).queryByRole('button', { name: /comment actions/i })).not.toBeInTheDocument()

    await user.click(item(rootId).getByRole('button', { name: /comment actions/i }))
    expect(item(rootId).getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(item(rootId).getByRole('button', { name: 'Delete' })).toBeInTheDocument()

    await user.click(item(replyId).getByRole('button', { name: /comment actions/i }))
    expect(item(replyId).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(item(replyId).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('edits inline with mention autocomplete and submits the same comment id with the selected mentions', async () => {
    const user = userEvent.setup()
    render(<CommentThread postId={postId} comments={[comment()]} />)

    await user.click(item(rootId).getByRole('button', { name: /comment actions/i }))
    await user.click(item(rootId).getByRole('button', { name: 'Edit' }))

    const editor = item(rootId).getByRole('textbox', { name: /edit comment/i })
    expect(editor).toHaveValue('Useful point.')
    await user.clear(editor)
    await user.type(editor, 'Updated note for @Rah')
    const option = await screen.findByRole('option', { name: /Rahul Gupta/i }, { timeout: 1200 })
    await user.click(option)
    await user.click(item(rootId).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.updateComment).toHaveBeenCalled())
    const [, formData] = mocks.updateComment.mock.calls[0] as unknown as [unknown, FormData]
    expect(formData.get('commentId')).toBe(rootId)
    expect(formData.get('body')).toBe('Updated note for @Rahul Gupta ')
    expect(formData.getAll('mentionProfileId')).toEqual(['44444444-4444-4444-8444-444444444444'])
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('keeps an edit draft open and shows the server error when save is rejected', async () => {
    const user = userEvent.setup()
    mocks.updateComment.mockResolvedValueOnce({ error: 'Comments can only be edited for 15 minutes after posting.', value: 'Draft remains.' } as never)
    render(<CommentThread postId={postId} comments={[comment()]} />)

    await user.click(item(rootId).getByRole('button', { name: /comment actions/i }))
    await user.click(item(rootId).getByRole('button', { name: 'Edit' }))
    const editor = item(rootId).getByRole('textbox', { name: /edit comment/i })
    await user.clear(editor)
    await user.type(editor, 'Draft remains.')
    await user.click(item(rootId).getByRole('button', { name: 'Save' }))

    expect(await item(rootId).findByRole('alert')).toHaveTextContent('Comments can only be edited for 15 minutes after posting.')
    expect(item(rootId).getByRole('textbox', { name: /edit comment/i })).toHaveValue('Draft remains.')
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('soft-delete action leaves failures inline and refreshes only after success', async () => {
    const user = userEvent.setup()
    mocks.deleteComment.mockResolvedValueOnce({ ok: false, error: 'We could not delete this comment.' } as never)
    render(<CommentThread postId={postId} comments={[comment()]} />)

    await user.click(item(rootId).getByRole('button', { name: /comment actions/i }))
    await user.click(item(rootId).getByRole('button', { name: 'Delete' }))

    expect(await item(rootId).findByRole('alert')).toHaveTextContent('We could not delete this comment.')
    expect(mocks.deleteComment).toHaveBeenCalledWith(rootId)
    expect(mocks.refresh).not.toHaveBeenCalled()

    await user.click(item(rootId).getByRole('button', { name: /comment actions/i }))
    await user.click(item(rootId).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })

  it('renders Edited only when updatedAt is later than createdAt', () => {
    render(<CommentThread postId={postId} comments={[
      comment({ updatedAt: '2026-09-10T09:02:00.000Z' }),
      comment({ id: otherId, parentCommentId: rootId, viewerOwns: false, canEdit: false, author: otherAuthor }),
    ]} />)

    expect(item(rootId).getByText('Edited')).toBeInTheDocument()
    expect(item(otherId).queryByText('Edited')).not.toBeInTheDocument()
  })

  it('renders a deleted root as a sanitized tombstone while preserving its visible replies', () => {
    const deletedRoot = comment({
      body: 'Deleted secret body mentioning @Rahul Gupta.',
      deleted: true,
      viewerOwns: true,
      canEdit: false,
      mentions: [{ profileId: '44444444-4444-4444-8444-444444444444', slug: 'rahul-gupta', fullName: 'Rahul Gupta' }],
      reactionSummary: { like: 2, support: 1, respect: 0, on_point: 0 },
      reactionCount: 3,
    })
    const reply = comment({
      id: replyId,
      parentCommentId: rootId,
      body: 'Visible reply survives.',
      viewerOwns: false,
      canEdit: false,
      author: otherAuthor,
    })

    render(<CommentThread postId={postId} comments={[deletedRoot, reply]} />)

    expect(item(rootId).getByText('Comment deleted')).toBeInTheDocument()
    expect(screen.queryByText(/Deleted secret body/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '@Rahul Gupta' })).not.toBeInTheDocument()
    expect(item(rootId).queryByRole('button', { name: /comment actions/i })).not.toBeInTheDocument()
    expect(item(rootId).queryByRole('button', { name: /reaction/i })).not.toBeInTheDocument()
    expect(item(replyId).getByText('Visible reply survives.')).toBeInTheDocument()
  })

  it('separates the total-only comment reaction opener from the unique reaction cluster and opens the same modal', async () => {
    const summary = { like: 2, support: 1, respect: 0, on_point: 1 }
    render(<CommentThread postId={postId} comments={[comment({ reactionSummary: summary, reactionCount: 4 })]} />)

    const total = item(rootId).getByRole('button', { name: /view 4 comment reactions/i })
    expect(total).toHaveTextContent('4 reactions')
    expect(total).not.toHaveTextContent('👍')
    expect(total).not.toHaveTextContent('❤️')
    expect(total).not.toHaveTextContent('⚓')

    const cluster = item(rootId).getByRole('button', { name: /view comment reaction types/i })
    expect(cluster).toHaveTextContent('👍❤️⚓')
    expect(cluster).not.toHaveTextContent('🫡')

    fireEvent.click(cluster)
    expect(screen.getByRole('dialog', { name: /reactions/i })).toBeInTheDocument()
    await waitFor(() => expect(mocks.loadReactionDetails).toHaveBeenCalledWith({
      targetType: 'comment',
      targetId: rootId,
      limit: 30,
    }))
  })
})
