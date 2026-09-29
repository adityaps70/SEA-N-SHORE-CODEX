import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeedPost } from '../types'
import { PostCard } from './post-card'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/community/marine-engineers',
}))

vi.mock('../actions', () => ({
  loadReactionDetails: vi.fn(async () => ({ ok: true, page: { reactors: [], nextCursor: null } })),
  deletePost: vi.fn(async () => ({ ok: true })),
  repostPost: vi.fn(async () => ({ ok: true, postId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })),
  setPostReaction: vi.fn(async () => ({ ok: true })),
  setPostSaved: vi.fn(async () => ({ ok: true })),
  setPostHidden: vi.fn(async () => ({ ok: true })),
  setCommentReaction: vi.fn(async () => ({ ok: true })),
  setPollVote: vi.fn(async () => ({ ok: true })),
  addComment: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/features/network/actions', () => ({
  followProfile: vi.fn(async () => ({ ok: true })),
  unfollowProfile: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/features/community/actions', () => ({ removeGroupPost: vi.fn(async () => ({ ok: true })) }))

function post(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    category: 'technical_discussion',
    body: 'Purifier vibration after the last overhaul: what would you check first?',
    postType: 'standard',
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
    author: { id: '11111111-1111-4111-8111-111111111111', slug: 'member-a', fullName: 'Member A', avatarPath: null, headline: 'Second Engineer', rank: 'Second Engineer', currentCompany: null },
    media: null,
    poll: null,
    likeCount: 0,
    commentCount: 0,
    viewerLiked: false,
    viewerSaved: false,
    viewerOwns: false,
    viewerFollowsAuthor: false,
    group: { id: '22222222-2222-4222-8222-222222222222', slug: 'marine-engineers', name: 'Marine Engineers', visibility: 'public', iconUrl: null },
    comments: [],
    ...overrides,
  }
}

afterEach(() => cleanup())

describe('PostCard role badge (round 9C)', () => {
  it('shows the "Moderator" / "Owner" chip next to the author name when the community passes one', () => {
    render(<PostCard post={post()} roleBadge="Moderator" />)
    const chip = screen.getByText('Moderator')
    expect(chip).toHaveClass('rounded-md', 'bg-ocean-50', 'text-ocean-700')
    expect(chip.parentElement).toContainElement(screen.getByRole('link', { name: 'Member A' }))
  })

  it('shows no chip without a badge', () => {
    render(<PostCard post={post()} />)
    expect(screen.queryByText('Moderator')).not.toBeInTheDocument()
    expect(screen.queryByText('Owner')).not.toBeInTheDocument()
  })
})
