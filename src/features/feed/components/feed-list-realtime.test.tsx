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

  it('reconciles mounted posts from canonical first-page props after a realtime router refresh', () => {
    const { rerender } = render(<FeedList initialPage={{ posts: [first], nextCursor: cursor }} />)
    const refreshedFirst = { ...first, body: 'Current post refreshed from canonical state.' }

    rerender(<FeedList initialPage={{ posts: [fresh, refreshedFirst], nextCursor: cursor }} />)

    expect(screen.getByText('Fresh post')).toBeInTheDocument()
    expect(screen.getByText('Current post refreshed from canonical state.')).toBeInTheDocument()
    expect(screen.queryByText('Current post')).not.toBeInTheDocument()
  })
})
describe('FeedList end of feed', () => {
  it('shows a calm end state and stops requesting once the last page has loaded', async () => {
    render(<FeedList initialPage={{ posts: [first], nextCursor: cursor }} />)

    await act(async () => {
      mocks.observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    })
    expect(await screen.findByText('Older post')).toBeInTheDocument()
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /load more posts/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Join communities' })).toHaveAttribute('href', '/community')

    await act(async () => {
      mocks.observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    })
    expect(mocks.loadFeedPage).toHaveBeenCalledTimes(1)
  })

  it('ignores a second intersection while a page is still loading', async () => {
    let resolvePage: (value: unknown) => void = () => {}
    mocks.loadFeedPage.mockImplementationOnce(() => new Promise((resolve) => { resolvePage = resolve }))
    render(<FeedList initialPage={{ posts: [first], nextCursor: cursor }} />)

    await act(async () => {
      mocks.observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
      mocks.observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    })
    expect(mocks.loadFeedPage).toHaveBeenCalledTimes(1)

    await act(async () => { resolvePage({ ok: true, page: { posts: [older], nextCursor: null } }) })
    expect(await screen.findByText('Older post')).toBeInTheDocument()
  })

  it('treats a page with no new posts as the end instead of looping', async () => {
    mocks.loadFeedPage.mockResolvedValueOnce({ ok: true, page: { posts: [first], nextCursor: { createdAt: older.createdAt, id: older.id } } })
    render(<FeedList initialPage={{ posts: [first], nextCursor: cursor }} />)

    await act(async () => {
      mocks.observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    })
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument()
    expect(mocks.loadFeedPage).toHaveBeenCalledTimes(1)
  })

  it('stops auto-loading after an error and retries only when asked', async () => {
    mocks.loadFeedPage.mockResolvedValueOnce({ ok: false, error: 'We could not load more posts.' })
    render(<FeedList initialPage={{ posts: [first], nextCursor: cursor }} />)

    await act(async () => {
      mocks.observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not load more posts.')

    await act(async () => {
      mocks.observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    })
    expect(mocks.loadFeedPage).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Older post')).toBeInTheDocument()
    expect(mocks.loadFeedPage).toHaveBeenCalledTimes(2)
  })
})
