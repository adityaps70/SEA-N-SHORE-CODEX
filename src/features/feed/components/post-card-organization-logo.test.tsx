import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mapOrganization } from '../mappers'
import type { FeedAuthor, FeedPost } from '../types'
import { PostCard } from './post-card'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/home',
}))

vi.mock('../actions', () => ({
  setPostReaction: vi.fn(async () => ({ ok: true })),
  setPostSaved: vi.fn(async () => ({ ok: true })),
  setPostHidden: vi.fn(async () => ({ ok: true })),
  deletePost: vi.fn(async () => ({ ok: true })),
  addComment: vi.fn(async () => ({ ok: true })),
  updateComment: vi.fn(async () => ({ ok: true })),
  deleteComment: vi.fn(async () => ({ ok: true })),
  setCommentReaction: vi.fn(async () => ({ ok: true })),
  loadReactionDetails: vi.fn(async () => ({ ok: true, page: { reactors: [], nextCursor: null } })),
}))

vi.mock('../mention-actions', () => ({ searchMentionCandidates: vi.fn(async () => []) }))

afterEach(cleanup)

const author: FeedAuthor = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'placeholder-member',
  fullName: 'Placeholder Member',
  avatarPath: null,
  avatarUrl: null,
  headline: null,
  rank: null,
  currentCompany: null,
}

function post(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    category: 'learning',
    body: 'Short post.',
    postType: 'standard',
    createdAt: '2026-09-20T08:00:00.000Z',
    updatedAt: '2026-09-20T08:00:00.000Z',
    author,
    media: null,
    poll: null,
    likeCount: 0,
    commentCount: 0,
    viewerLiked: false,
    viewerSaved: false,
    comments: [],
    ...overrides,
  }
}

describe('post author avatar for organization posts (round H, H6)', () => {
  it('maps the organization logo path to the first-party logo route', () => {
    expect(mapOrganization({ id: 'c1', slug: 'placeholder-lines', name: 'Placeholder Lines', logo_path: 'companies/c1/logo.png' })?.logoUrl).toBe('/api/company-logo/c1')
    expect(mapOrganization({ id: 'c1', slug: 'placeholder-lines', name: 'Placeholder Lines', logo_path: null })?.logoUrl).toBeNull()
  })

  it('shows the organization logo, not initials, when the organization has one', () => {
    const organization = mapOrganization({ id: 'c1', slug: 'placeholder-lines', name: 'Placeholder Lines', logo_path: 'companies/c1/logo.png' })
    render(<PostCard post={post({ organization })} />)
    const avatar = screen.getByRole('link', { name: "View Placeholder Lines's page" })
    expect(avatar).toHaveAttribute('href', '/organizations/placeholder-lines')
    expect(screen.getByRole('img', { name: 'Placeholder Lines logo' })).toHaveAttribute('src', '/api/company-logo/c1')
    expect(avatar).toContainElement(screen.getByRole('img', { name: 'Placeholder Lines logo' }))
  })

  it('falls back to the organization initials when it has no logo', () => {
    render(<PostCard post={post({ organization: { id: 'c1', slug: 'placeholder-lines', name: 'Placeholder Lines', logoUrl: null } })} />)
    const avatar = screen.getByRole('link', { name: "View Placeholder Lines's page" })
    expect(avatar.querySelector('img')).toBeNull()
    expect(avatar).toHaveTextContent('PL')
  })
})
