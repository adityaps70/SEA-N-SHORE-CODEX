import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeedComment } from '../types'
import { CommentThread } from './comment-thread'

const mocks = vi.hoisted(() => ({
  addComment: vi.fn<(state: unknown, formData: FormData) => Promise<Record<string, unknown>>>(async () => ({ ok: true })),
  updateComment: vi.fn(async () => ({ ok: true as const })),
  deleteComment: vi.fn(async () => ({ ok: true as const })),
  setCommentReaction: vi.fn(async () => ({ ok: true as const })),
  loadReactionDetails: vi.fn(async () => ({ ok: true as const, page: { reactors: [], nextCursor: null } })),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/home',
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
const replyIds = [
  'c1111111-1111-4111-8111-111111111111',
  'c2222222-2222-4222-8222-222222222222',
  'c3333333-3333-4333-8333-333333333333',
]

function person(id: string, name: string, slug: string) {
  return { id, slug, fullName: name, avatarPath: null, avatarUrl: null, headline: null, rank: 'Master', currentCompany: null }
}

const postAuthor = person('10000000-0000-4000-8000-000000000000', 'Post Author', 'post-author')
const priya = person('20000000-0000-4000-8000-000000000000', 'Priya Nair', 'priya-nair')
const ravi = person('30000000-0000-4000-8000-000000000000', 'Ravi Menon', 'ravi-menon')

function comment(overrides: Partial<FeedComment> = {}): FeedComment {
  return {
    id: rootId,
    body: 'Top-level question about ballast exchange.',
    createdAt: '2026-09-10T09:00:00.000Z',
    updatedAt: '2026-09-10T09:00:00.000Z',
    viewerOwns: false,
    canEdit: false,
    deleted: false,
    author: priya,
    parentCommentId: null,
    replyTo: null,
    reactionSummary: { like: 0, support: 0, respect: 0, on_point: 0 },
    reactionCount: 0,
    viewerReaction: null,
    mentions: [],
    ...overrides,
  }
}

function reply(index: number, overrides: Partial<FeedComment> = {}) {
  return comment({
    id: replyIds[index],
    body: `Reply number ${index + 1}.`,
    parentCommentId: rootId,
    createdAt: `2026-09-10T09:0${index + 1}:00.000Z`,
    updatedAt: `2026-09-10T09:0${index + 1}:00.000Z`,
    author: ravi,
    ...overrides,
  })
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

describe('CommentThread reply threading', () => {
  it('marks parents and replies differently and indents replies under a thread line', () => {
    render(<CommentThread postId={postId} postAuthorId={postAuthor.id} comments={[comment(), reply(0)]} />)
    expect(document.getElementById(`comment-${rootId}`)).toHaveAttribute('data-comment-level', 'parent')
    expect(document.getElementById(`comment-${replyIds[0]}`)).toHaveAttribute('data-comment-level', 'reply')
    const group = screen.getByTestId(`reply-group-${rootId}`)
    expect(group).toHaveClass('border-l-2')
    expect(within(group).getByRole('group', { name: 'Replies to Priya Nair' })).toContainElement(document.getElementById(`comment-${replyIds[0]}`))
  })

  it('shows who each reply answers, falling back to the parent comment author', () => {
    render(<CommentThread postId={postId} comments={[
      comment(),
      reply(0),
      reply(1, { author: priya, replyTo: { commentId: replyIds[0], authorName: 'Ravi Menon', authorSlug: 'ravi-menon' } }),
    ]} />)
    expect(screen.getByTestId(`reply-target-${replyIds[0]}`)).toHaveTextContent('Replying to Priya Nair')
    expect(screen.getByTestId(`reply-target-${replyIds[1]}`)).toHaveTextContent('Replying to Ravi Menon')
    expect(within(screen.getByTestId(`reply-target-${replyIds[1]}`)).getByRole('link', { name: 'Ravi Menon' })).toHaveAttribute('href', '/people/ravi-menon')
    expect(screen.queryByTestId(`reply-target-${rootId}`)).not.toBeInTheDocument()
  })

  it('renders nothing (no empty bordered band) when there is no comment to show and the composer is closed', () => {
    const { container } = render(<CommentThread postId={postId} comments={[]} />)
    expect(container).toBeEmptyDOMElement()
    cleanup()
    render(<CommentThread postId={postId} comments={[]} composerOpen />)
    expect(screen.getByRole('textbox', { name: 'Add a comment' })).toBeInTheDocument()
  })

  it('labels the post author in the thread', () => {
    render(<CommentThread postId={postId} postAuthorId={postAuthor.id} comments={[comment(), reply(0, { author: postAuthor })]} />)
    expect(item(replyIds[0]).getByText('Author')).toBeInTheDocument()
    expect(item(rootId).queryByText('Author')).not.toBeInTheDocument()
  })

  it('collapses long threads behind “View N replies” and toggles with Hide replies', () => {
    render(<CommentThread postId={postId} comments={[comment(), reply(0), reply(1), reply(2)]} />)
    const toggle = screen.getByRole('button', { name: 'View 3 replies' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Reply number 1.')).not.toBeInTheDocument()
    expect(item(rootId).getByLabelText('3 replies')).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(screen.getByText('Reply number 1.')).toBeInTheDocument()
    expect(screen.getByText('Reply number 3.')).toBeInTheDocument()
    const hide = screen.getByRole('button', { name: 'Hide replies' })
    expect(hide).toHaveAttribute('aria-expanded', 'true')
    expect(hide).toHaveAttribute('aria-controls', `replies-${rootId}`)

    fireEvent.click(hide)
    expect(screen.queryByText('Reply number 1.')).not.toBeInTheDocument()
  })

  it('shows short threads expanded, and everything expanded on the single-post page', () => {
    render(<CommentThread postId={postId} comments={[comment(), reply(0), reply(1)]} />)
    expect(screen.getByText('Reply number 2.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide replies' })).toBeInTheDocument()

    cleanup()
    render(<CommentThread postId={postId} comments={[comment(), reply(0), reply(1), reply(2)]} expandReplies />)
    expect(screen.getByText('Reply number 3.')).toBeInTheDocument()
  })

  it('replies to a reply in the same thread and targets that reply', async () => {
    const user = userEvent.setup()
    const created = reply(2, { body: 'Answering Ravi directly.', author: priya, replyTo: { commentId: replyIds[0], authorName: 'Ravi Menon', authorSlug: 'ravi-menon' } })
    mocks.addComment.mockResolvedValueOnce({ ok: true, comment: created })
    render(<CommentThread postId={postId} comments={[comment(), reply(0)]} />)

    await user.click(item(replyIds[0]).getByRole('button', { name: 'Reply' }))
    const form = screen.getByRole('form', { name: 'Reply to Ravi Menon' })
    expect(form).toHaveTextContent('Replying to Ravi Menon')
    await user.type(within(form).getByRole('textbox', { name: /write a reply to ravi menon/i }), 'Answering Ravi directly.')
    await user.click(within(form).getByRole('button', { name: 'Reply' }))

    await waitFor(() => expect(mocks.addComment).toHaveBeenCalled())
    const formData = mocks.addComment.mock.calls[0]?.[1] as FormData
    expect(formData.get('parentCommentId')).toBe(replyIds[0])
    expect(formData.get('postId')).toBe(postId)
    expect(await screen.findByText('Answering Ravi directly.')).toBeInTheDocument()
    expect(screen.getByTestId(`reply-target-${replyIds[2]}`)).toHaveTextContent('Replying to Ravi Menon')
  })

  it('expands a collapsed thread when the viewer adds a reply to it', async () => {
    const user = userEvent.setup()
    mocks.addComment.mockResolvedValueOnce({ ok: true, comment: reply(2, { id: 'c4444444-4444-4444-8444-444444444444', body: 'Fresh reply appears.' }) })
    render(<CommentThread postId={postId} comments={[comment(), reply(0), reply(1), reply(2)]} />)
    expect(screen.getByRole('button', { name: 'View 3 replies' })).toBeInTheDocument()

    await user.click(item(rootId).getByRole('button', { name: 'Reply' }))
    await user.type(item(rootId).getByRole('textbox', { name: /write a reply/i }), 'Fresh reply appears.')
    await user.click(within(screen.getByRole('form', { name: 'Reply to Priya Nair' })).getByRole('button', { name: 'Reply' }))

    expect(await screen.findByText('Fresh reply appears.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide replies' })).toBeInTheDocument()
    expect(item(rootId).getByLabelText('4 replies')).toBeInTheDocument()
  })
})

describe('emoji in comments', () => {
  it('inserts an emoji into the comment composer at the caret and submits it', async () => {
    const user = userEvent.setup()
    render(<CommentThread postId={postId} comments={[]} composerOpen />)
    const textbox = screen.getByRole('textbox', { name: 'Add a comment' })
    await user.type(textbox, 'Safe passage')
    await user.click(screen.getByRole('button', { name: 'Add emoji to comment' }))
    const picker = screen.getByRole('menu', { name: 'Choose emoji' })
    await user.click(within(picker).getByRole('menuitem', { name: 'Insert 🚢' }))
    expect(textbox).toHaveValue('Safe passage 🚢')
    expect(screen.queryByRole('menu', { name: 'Choose emoji' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Comment' }))
    await waitFor(() => expect(mocks.addComment).toHaveBeenCalled())
    expect((mocks.addComment.mock.calls[0]?.[1] as FormData).get('body')).toBe('Safe passage 🚢')
  })

  it('inserts at the caret position instead of the end', () => {
    render(<CommentThread postId={postId} comments={[]} composerOpen />)
    const textbox = screen.getByRole('textbox', { name: 'Add a comment' }) as HTMLTextAreaElement
    fireEvent.change(textbox, { target: { value: 'Well done crew' } })
    textbox.setSelectionRange(9, 9)
    fireEvent.click(screen.getByRole('button', { name: 'Add emoji to comment' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Insert 👏' }))
    expect(textbox).toHaveValue('Well done 👏 crew')
  })

  it('offers the emoji picker in the reply composer too, and Escape closes it', async () => {
    const user = userEvent.setup()
    render(<CommentThread postId={postId} comments={[comment()]} />)
    await user.click(item(rootId).getByRole('button', { name: 'Reply' }))
    const textbox = item(rootId).getByRole('textbox', { name: /write a reply/i })
    await user.type(textbox, 'Agreed')
    const trigger = item(rootId).getByRole('button', { name: 'Add emoji to reply' })
    await user.click(trigger)
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Insert 👍' }), { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: 'Choose emoji' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: 'Insert 👍' }))
    expect(textbox).toHaveValue('Agreed 👍')
  })
})

describe('comment reaction count placement', () => {
  it('puts the comment reaction total before the reaction symbols', () => {
    render(<CommentThread postId={postId} comments={[comment({ reactionSummary: { like: 5, support: 0, respect: 2, on_point: 0 }, reactionCount: 7 })]} />)
    const summary = item(rootId).getByRole('button', { name: 'View 7 comment reactions' })
    expect(summary).toHaveTextContent(/^7👍🫡$/)
    expect(summary.firstElementChild).toHaveTextContent('7')
  })
})
