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
  setCommentReaction: vi.fn(async () => ({ ok: true })),
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

    await user.type(screen.getByPlaceholderText('Add a professional comment…'), '@Rah')

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
})
