import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedPage, FeedPost } from '../types'

/**
 * Round ARCH (broadcast fix): a realtime hint that someone in the member's network posted asks the server for the
 * "N new posts" count straight away (at most once per 2 s), instead of the old full-page re-render. Likes and
 * comments don't trigger it; without a realtime connection the 60-second count check is unchanged.
 */
const mocks = vi.hoisted(() => ({
  countNewTopPosts: vi.fn(async () => ({ ok: true as const, count: 2 })),
  listeners: new Set<(signal: { eventType: string }) => void>(),
  realtime: true,
}))

vi.mock('../actions', () => ({
  countNewTopPosts: mocks.countNewTopPosts,
  loadRecentFeedPage: vi.fn(),
  loadTopFeedPage: vi.fn(),
  setFeedMode: vi.fn(),
}))
vi.mock('@/features/realtime/provider', () => ({
  useOptionalMessagingRealtime: () => mocks.realtime
    ? { subscribe: (listener: (signal: { eventType: string }) => void) => { mocks.listeners.add(listener); return () => mocks.listeners.delete(listener) } }
    : null,
}))
vi.mock('./post-card', () => ({ PostCard: ({ post }: { post: FeedPost }) => <article>{post.body}</article> }))
vi.mock('./feed-people-row', () => ({ FeedPeopleRow: () => null, peopleRowPositions: () => new Set<number>() }))
vi.mock('@/features/network/components/suggestion-deck', () => ({ useSuggestionDeck: () => ({ profiles: [] }) }))
vi.mock('../impressions/use-post-impressions', () => ({ usePostImpressions: () => () => {}, flushPendingImpressions: async () => {} }))
vi.mock('@/components/navigation/intent-link', () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }))

const { HomeFeed, NEW_POSTS_HINT_DEBOUNCE_MS, NEW_POSTS_POLL_MS } = await import('./home-feed')

const post: FeedPost = {
  id: '11111111-1111-4111-8111-111111111111', category: 'technical_discussion', body: 'Placeholder post', postType: 'standard',
  createdAt: '2026-11-08T05:00:00.000Z', updatedAt: '2026-11-08T05:00:00.000Z',
  author: { id: 'author-1', slug: 'author-1', fullName: 'Fixture Author', avatarPath: null, headline: null, rank: null, currentCompany: null },
  media: null, poll: null, likeCount: 0, viewerLiked: false, commentCount: 0, viewerSaved: false, comments: [],
}
const page: FeedPage = { posts: [post], nextCursor: null }

class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
  root = null
  rootMargin = ''
  thresholds = [0]
}

function hint(eventType: string) {
  for (const listener of mocks.listeners) listener({ eventType })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false })
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  mocks.listeners.clear()
  mocks.realtime = true
  mocks.countNewTopPosts.mockClear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('HomeFeed realtime "new posts" hint', () => {
  it('asks for the count once per 2 s when a network member posts or reposts, not on likes or comments', async () => {
    render(<HomeFeed initialMode="recent" initialRecentPage={page} suggestions={[]} />)
    expect(mocks.listeners.size).toBe(1)

    act(() => {
      hint('feed.post_reaction_changed')
      hint('feed.post_comments_changed')
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(NEW_POSTS_HINT_DEBOUNCE_MS + 10) })
    expect(mocks.countNewTopPosts).not.toHaveBeenCalled()

    act(() => {
      hint('feed.post_created')
      hint('feed.post_reposted')
      hint('feed.post_created')
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(NEW_POSTS_HINT_DEBOUNCE_MS + 10) })
    expect(mocks.countNewTopPosts).toHaveBeenCalledTimes(1)
    expect(mocks.countNewTopPosts).toHaveBeenCalledWith({ since: post.createdAt })
  })

  it('keeps the 60-second count check without a realtime connection, and stops listening on unmount', async () => {
    mocks.realtime = false
    const view = render(<HomeFeed initialMode="recent" initialRecentPage={page} suggestions={[]} />)
    expect(mocks.listeners.size).toBe(0)
    await act(async () => { await vi.advanceTimersByTimeAsync(NEW_POSTS_POLL_MS + 10) })
    expect(mocks.countNewTopPosts).toHaveBeenCalledTimes(1)
    view.unmount()

    mocks.realtime = true
    const second = render(<HomeFeed initialMode="recent" initialRecentPage={page} suggestions={[]} />)
    expect(mocks.listeners.size).toBe(1)
    second.unmount()
    expect(mocks.listeners.size).toBe(0)
  })
})
