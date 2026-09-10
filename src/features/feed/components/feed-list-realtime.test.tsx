import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedPage, FeedPost } from '../types'
import { FeedList } from './feed-list'

const mocks = vi.hoisted(() => ({
  loadFeedPage: vi.fn(),
  observerCallback: null as IntersectionObserverCallback | null,
}))

vi.mock('../actions', () => ({ loadFeedPage: mocks.loadFeedPage }))
vi.mock('./post-card', () => ({ PostCard: ({ post }: { post: FeedPost }) => <article data-testid={`post-${post.id}`}>{post.body}</article> }))

function post(id: string, body: string, createdAt: string): FeedPost {
  return {
    id,
    category: 'technical_discussion',
    body,
    postType: 'standard',
    createdAt,
    updatedAt: createdAt,
    author: { id: `author-${id}`, slug: `author-${id}`, fullName: `Author ${id}`, avatarPath: null, headline: null, rank: null, currentCompany: null },
    media: null,
    poll: null,
    likeCount: 0,
    viewerLiked: false,
    commentCount: 0,
    viewerSaved: false,
    comments: [],
  }
}

const first = post('11111111-1111-4111-8111-111111111111', 'Current post', '2026-09-10T09:00:00.000Z')
const older = post('22222222-2222-4222-8222-222222222222', 'Older post', '2026-09-10T08:00:00.000Z')
const fresh = post('33333333-3333-4333-8333-333333333333', 'Fresh post', '2026-09-10T09:10:00.000Z')
const cursor = { createdAt: first.createdAt, id: first.id }

class MockIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) { mocks.observerCallback = callback }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
  root = null
  rootMargin = ''
  thresholds = [0]
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  mocks.loadFeedPage.mockImplementation(async (request: { cursor?: unknown }) => {
    if (request.cursor) return { ok: true, page: { posts: [older], nextCursor: null } satisfies FeedPage }
    return { ok: true, page: { posts: [fresh, first], nextCursor: cursor } satisfies FeedPage }
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('FeedList incremental freshness', () => {
  it('loads the next cursor page when the sentinel becomes visible', async () => {
    render(<FeedList initialPage={{ posts: [first], nextCursor: cursor }} />)
    expect(mocks.observerCallback).toBeTypeOf('function')

    await act(async () => {
      mocks.observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    })

    expect(await screen.findByText('Older post')).toBeInTheDocument()
    expect(mocks.loadFeedPage).toHaveBeenCalledWith({ category: undefined, cursor, limit: 12 })
  })

  it('polls for newer posts without replacing the mounted feed and prepends only after opt-in', async () => {
    render(<FeedList initialPage={{ posts: [first], nextCursor: cursor }} />)

    await act(async () => { vi.advanceTimersByTime(30_000) })
    await waitFor(() => expect(mocks.loadFeedPage).toHaveBeenCalledWith({ category: undefined, limit: 12 }))

    expect(screen.getByText('Current post')).toBeInTheDocument()
    expect(screen.queryByText('Fresh post')).not.toBeInTheDocument()
    const button = await screen.findByRole('button', { name: /1 new post/i })
    fireEvent.click(button)

    expect(await screen.findByText('Fresh post')).toBeInTheDocument()
    expect(screen.getByText('Current post')).toBeInTheDocument()
  })
})