import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeedComment } from '../types'
import { CommentThread } from './comment-thread'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  searchMentionCandidates: vi.fn(async () => ([{
    id: '22222222-2222-4222-8222-222222222222',
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
  addComment: vi.fn(async () => ({ ok: false })),
  updateComment: vi.fn(async () => ({ ok: false })),
  deleteComment: vi.fn(async () => ({ ok: true })),
  setCommentReaction: vi.fn(async () => ({ ok: true })),
  loadReactionDetails: vi.fn(async () => ({ ok: true, reactions: [] })),
}))

vi.mock('../mention-actions', () => ({
  searchMentionCandidates: mocks.searchMentionCandidates,
}))

const rootComment: FeedComment = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  body: 'Useful point.',
  createdAt: '2026-09-10T06:00:00.000Z',
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
  parentCommentId: null,
  mentions: [],
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CommentThread mentions', () => {
  it('offers member autocomplete when typing @ in a new comment', async () => {
    const user = userEvent.setup()
    render(<CommentThread postId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" comments={[]} composerOpen />)

    await user.type(screen.getByPlaceholderText('Write a comment…'), '@Rah')

    expect(await screen.findByRole('option', { name: /Rahul Gupta/i }, { timeout: 1200 })).toBeInTheDocument()
    expect(mocks.searchMentionCandidates).toHaveBeenCalledWith('Rah')
  })

  it('offers the same member autocomplete in a reply composer', async () => {
    const user = userEvent.setup()
    render(<CommentThread postId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" comments={[rootComment]} composerOpen />)

    await user.click(screen.getByRole('button', { name: 'Reply' }))
    await user.type(screen.getByPlaceholderText('Write a reply…'), '@Rah')

    expect(await screen.findByRole('option', { name: /Rahul Gupta/i }, { timeout: 1200 })).toBeInTheDocument()
    expect(mocks.searchMentionCandidates).toHaveBeenCalledWith('Rah')
  })

  it('renders stored mentions in comment text as profile links', () => {
    render(<CommentThread
      postId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      comments={[{
        ...rootComment,
        body: 'Thanks @Rahul Gupta for the guidance.',
        mentions: [{
          profileId: '22222222-2222-4222-8222-222222222222',
          slug: 'rahul-gupta',
          fullName: 'Rahul Gupta',
        }],
      }]}
      readOnly
    />)

    expect(screen.getByRole('link', { name: '@Rahul Gupta' })).toHaveAttribute('href', '/people/rahul-gupta')
  })

  it('renders organization mentions and hashtags in comment text as links', () => {
    render(<CommentThread
      postId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      comments={[{
        ...rootComment,
        body: 'Great work @SIRE Marine on the #vetting drive.',
        organizationMentions: [{
          companyId: '33333333-3333-4333-8333-333333333333',
          slug: 'sire-marine',
          name: 'SIRE Marine',
          logoUrl: null,
        }],
      }]}
      readOnly
    />)

    expect(screen.getByRole('link', { name: '@SIRE Marine' })).toHaveAttribute('href', '/organizations/sire-marine')
    expect(screen.getByRole('link', { name: '#vetting' })).toHaveAttribute('href', '/hashtags/vetting')
  })

  it('submits a picked organization as a hidden organizationMentionId in a new comment', async () => {
    mocks.searchMentionCandidates.mockResolvedValueOnce([{
      kind: 'organization',
      id: '33333333-3333-4333-8333-333333333333',
      slug: 'sire-marine',
      name: 'SIRE Marine',
      logoUrl: null,
      subtitle: 'Ship manager',
    }] as never)
    const user = userEvent.setup()
    render(<CommentThread postId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" comments={[]} composerOpen />)

    const textarea = screen.getByPlaceholderText('Write a comment…')
    await user.type(textarea, 'Well done @SI')
    await user.click(await screen.findByRole('option', { name: /SIRE Marine/ }, { timeout: 1200 }))

    expect(textarea).toHaveValue('Well done @SIRE Marine ')
    const form = textarea.closest('form')!
    expect(form.querySelector<HTMLInputElement>('input[name="organizationMentionId"]')?.value).toBe('33333333-3333-4333-8333-333333333333')
    expect(form.querySelector('input[name="mentionProfileId"]')).toBeNull()
  })

  it('pre-fills organization mentions when editing a comment so they survive the save', async () => {
    const user = userEvent.setup()
    render(<CommentThread
      postId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      comments={[{
        ...rootComment,
        body: 'Great work @SIRE Marine.',
        updatedAt: rootComment.createdAt,
        viewerOwns: true,
        canEdit: true,
        deleted: false,
        organizationMentions: [{
          companyId: '33333333-3333-4333-8333-333333333333',
          slug: 'sire-marine',
          name: 'SIRE Marine',
          logoUrl: null,
        }],
      }]}
    />)

    await user.click(screen.getByRole('button', { name: /comment actions/i }))
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))

    const textarea = screen.getByPlaceholderText('Edit comment…')
    const form = textarea.closest('form')!
    expect(form.querySelector<HTMLInputElement>('input[name="organizationMentionId"]')?.value).toBe('33333333-3333-4333-8333-333333333333')
  })
})
