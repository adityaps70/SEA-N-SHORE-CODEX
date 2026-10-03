import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeedAuthor, FeedComment, FeedPost } from '../types'
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

const rinki: FeedAuthor = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'rinki-mukharjee',
  fullName: 'Rinki Mukharjee',
  avatarPath: 'profiles/rinki/avatar.webp',
  avatarUrl: 'https://signed.example/rinki.webp',
  headline: 'Second Officer',
  rank: null,
  currentCompany: null,
}

const arjun: FeedAuthor = {
  ...rinki,
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'arjun-rao',
  fullName: 'Arjun Rao',
  avatarPath: null,
  avatarUrl: null,
}

const LONG = `${'Cargo tank cleaning checklist and lessons from our last voyage. '.repeat(8)}Final tip: plan ahead.`

function comment(overrides: Partial<FeedComment> = {}): FeedComment {
  return { id: 'c1111111-1111-4111-8111-111111111111', body: 'Great notes.', createdAt: '2026-09-20T08:00:00.000Z', author: arjun, ...overrides }
}

function post(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    category: 'learning',
    body: 'Short post.',
    postType: 'standard',
    createdAt: '2026-09-20T08:00:00.000Z',
    updatedAt: '2026-09-20T08:00:00.000Z',
    author: rinki,
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

describe('PostCard long text', () => {
  it('collapses a long post body behind “…more” and expands it inline', () => {
    render(<PostCard post={post({ body: LONG })} />)

    const article = screen.getByRole('article')
    expect(article).not.toHaveTextContent('Final tip: plan ahead.')
    const more = within(article).getByRole('button', { name: 'more' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(more)
    expect(article).toHaveTextContent('Final tip: plan ahead.')
    expect(within(article).getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows the full text on the single-post page', () => {
    render(<PostCard post={post({ body: LONG })} detail />)
    expect(screen.getByRole('article')).toHaveTextContent('Final tip: plan ahead.')
  })

  it('collapses repost thoughts and the embedded original separately', () => {
    render(<PostCard post={post({
      postType: 'repost',
      author: arjun,
      body: `${'My thoughts on this lesson. '.repeat(15)}Thoughts end.`,
      repostOf: {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        category: 'learning',
        body: LONG,
        postType: 'standard',
        createdAt: '2026-09-19T08:00:00.000Z',
        updatedAt: '2026-09-19T08:00:00.000Z',
        author: rinki,
        media: null,
        poll: null,
      },
    })} />)

    const original = screen.getByRole('region', { name: 'Original post by Rinki Mukharjee' })
    const buttons = screen.getAllByRole('button', { name: 'more' })
    expect(buttons).toHaveLength(2)
    fireEvent.click(within(original).getByRole('button', { name: 'more' }))
    expect(original).toHaveTextContent('Final tip: plan ahead.')
    expect(screen.getByRole('article')).not.toHaveTextContent('Thoughts end.')
  })

  it('collapses long comments after about three lines', () => {
    const longComment = `${'Agree with the tank entry permit steps. '.repeat(8)}Comment end.`
    render(<PostCard post={post({ commentCount: 1, comments: [comment({ body: longComment })] })} />)

    const thread = document.getElementById('comments-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')!
    expect(thread).not.toHaveTextContent('Comment end.')
    fireEvent.click(within(thread).getByRole('button', { name: 'more' }))
    expect(thread).toHaveTextContent('Comment end.')
  })
})

describe('PostCard profile photos', () => {
  it('links the author photo and name to the profile with an accessible name', () => {
    render(<PostCard post={post()} />)

    const avatar = screen.getByRole('link', { name: "View Rinki Mukharjee's profile" })
    expect(avatar).toHaveAttribute('href', '/people/rinki-mukharjee')
    expect(within(avatar).getByRole('img', { name: "Rinki Mukharjee's profile photo" })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Rinki Mukharjee' })).toHaveAttribute('href', '/people/rinki-mukharjee')
  })

  it('links an organization post’s logo to the organization page', () => {
    render(<PostCard post={post({ organization: { id: 'c1', slug: 'nordic-lng', name: 'Nordic LNG', logoUrl: '/api/company-logo/c1' } })} />)

    expect(screen.getByRole('link', { name: "View Nordic LNG's page" })).toHaveAttribute('href', '/organizations/nordic-lng')
    expect(screen.queryByRole('link', { name: "View Rinki Mukharjee's profile" })).not.toBeInTheDocument()
  })

  it('links the reposter and the original author photos', () => {
    render(<PostCard post={post({
      postType: 'repost',
      author: arjun,
      body: '',
      repostOf: {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        category: 'learning',
        body: 'Original.',
        postType: 'standard',
        createdAt: '2026-09-19T08:00:00.000Z',
        updatedAt: '2026-09-19T08:00:00.000Z',
        author: rinki,
        media: null,
        poll: null,
      },
    })} />)

    const reposter = screen.getByRole('link', { name: "View Arjun Rao's profile" })
    expect(reposter).toHaveAttribute('href', '/people/arjun-rao')
    expect(reposter).toHaveTextContent('AR')
    const original = screen.getByRole('region', { name: 'Original post by Rinki Mukharjee' })
    expect(within(original).getByRole('link', { name: "View Rinki Mukharjee's profile" })).toHaveAttribute('href', '/people/rinki-mukharjee')
  })

  it('links comment and reply author photos to their profiles', () => {
    const reply = comment({ id: 'c2222222-2222-4222-8222-222222222222', body: 'Thanks!', author: rinki, parentCommentId: 'c1111111-1111-4111-8111-111111111111' })
    render(<PostCard post={post({ commentCount: 2, comments: [comment(), reply] })} />)

    const thread = document.getElementById('comments-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')!
    expect(within(thread).getByRole('link', { name: "View Arjun Rao's profile" })).toHaveAttribute('href', '/people/arjun-rao')
    expect(within(thread).getByRole('link', { name: "View Rinki Mukharjee's profile" })).toHaveAttribute('href', '/people/rinki-mukharjee')
  })
})
