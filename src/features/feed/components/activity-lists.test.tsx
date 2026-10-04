import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommentActivity } from '../queries'
import type { CursorPage, FeedPost } from '../types'
import { ActivityPostList, CommentActivityList } from './activity-lists'

const mocks = vi.hoisted(() => ({
  loadMyActivityPostsPage: vi.fn(),
  loadMyCommentActivityPage: vi.fn(),
  observerCallback: null as IntersectionObserverCallback | null,
}))

vi.mock('../actions', () => ({
  loadMyActivityPostsPage: mocks.loadMyActivityPostsPage,
  loadMyCommentActivityPage: mocks.loadMyCommentActivityPage,
}))
vi.mock('./post-card', () => ({
  PostCard: ({ post }: { post: { id: string; body: string } }) => <article data-testid="post">{post.body}</article>,
}))
vi.mock('./comment-activity-card', () => ({
  CommentActivityCard: ({ activity }: { activity: { post: { body: string } } }) => <section data-testid="comment-activity">{activity.post.body}</section>,
}))

class MockIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) { mocks.observerCallback = callback }
  observe() {}
  disconnect() {}
}

function post(n: number): FeedPost {
  return { id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, body: `Post ${n}` } as FeedPost
}

function cursorOf(n: number) {
  return { createdAt: `2026-09-05T07:00:${String(n).padStart(2, '0')}.000000Z`, id: post(n).id }
}

function postsPage(numbers: number[], next: number | null): CursorPage<FeedPost> {
  return { entries: numbers.map((n) => ({ cursor: cursorOf(n), item: post(n) })), nextCursor: next === null ? null : cursorOf(next) }
}

const shownPosts = () => screen.getAllByTestId('post').map((node) => node.textContent)

beforeEach(() => {
  mocks.loadMyActivityPostsPage.mockReset()
  mocks.loadMyCommentActivityPage.mockReset()
  mocks.observerCallback = null
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ActivityPostList (Round 14, 3.7)', () => {
  it('renders a short list exactly as before, with no footer', () => {
    render(<ActivityPostList initialPage={postsPage([3, 2, 1], null)} />)
    expect(shownPosts()).toEqual(['Post 3', 'Post 2', 'Post 1'])
    expect(screen.queryByRole('button', { name: 'Load more posts' })).not.toBeInTheDocument()
  })

  it('loads the next page from the cursor with Load more and ends the list', async () => {
    mocks.loadMyActivityPostsPage.mockResolvedValueOnce({ ok: true, page: postsPage([7, 6], null) })
    render(<ActivityPostList initialPage={postsPage([9, 8], 8)} />)

    fireEvent.click(screen.getByRole('button', { name: 'Load more posts' }))

    await waitFor(() => expect(shownPosts()).toEqual(['Post 9', 'Post 8', 'Post 7', 'Post 6']))
    expect(mocks.loadMyActivityPostsPage).toHaveBeenCalledWith({ cursor: cursorOf(8) })
    expect(screen.queryByRole('button', { name: 'Load more posts' })).not.toBeInTheDocument()
  })

  it('loads the next page when the end of the list scrolls into view, one request at a time', async () => {
    let resolve: (value: unknown) => void = () => undefined
    mocks.loadMyActivityPostsPage.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    render(<ActivityPostList initialPage={postsPage([9, 8], 8)} />)

    act(() => {
      mocks.observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
      mocks.observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    })
    expect(mocks.loadMyActivityPostsPage).toHaveBeenCalledTimes(1)

    await act(async () => { resolve({ ok: true, page: postsPage([7], 7) }) })
    expect(shownPosts()).toEqual(['Post 9', 'Post 8', 'Post 7'])
    expect(screen.getByRole('button', { name: 'Load more posts' })).toBeEnabled()
  })

  it('shows the error with Try again and retries the same cursor', async () => {
    mocks.loadMyActivityPostsPage
      .mockResolvedValueOnce({ ok: false, error: 'We could not load more posts.' })
      .mockResolvedValueOnce({ ok: true, page: postsPage([7], null) })
    render(<ActivityPostList initialPage={postsPage([9, 8], 8)} />)

    fireEvent.click(screen.getByRole('button', { name: 'Load more posts' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not load more posts.')

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(shownPosts()).toEqual(['Post 9', 'Post 8', 'Post 7']))
    expect(mocks.loadMyActivityPostsPage).toHaveBeenNthCalledWith(2, { cursor: cursorOf(8) })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('drops a deleted post when the server re-renders the first page, keeping loaded pages', async () => {
    mocks.loadMyActivityPostsPage.mockResolvedValueOnce({ ok: true, page: postsPage([7, 6], 6) })
    const { rerender } = render(<ActivityPostList initialPage={postsPage([9, 8], 8)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Load more posts' }))
    await waitFor(() => expect(shownPosts()).toEqual(['Post 9', 'Post 8', 'Post 7', 'Post 6']))

    // Post 8 was deleted; the revalidated first page now ends at 7.
    rerender(<ActivityPostList initialPage={postsPage([9, 7], 7)} />)

    expect(shownPosts()).toEqual(['Post 9', 'Post 7', 'Post 6'])
    mocks.loadMyActivityPostsPage.mockResolvedValueOnce({ ok: true, page: postsPage([5], null) })
    fireEvent.click(screen.getByRole('button', { name: 'Load more posts' }))
    await waitFor(() => expect(mocks.loadMyActivityPostsPage).toHaveBeenLastCalledWith({ cursor: cursorOf(6) }))
  })
})

describe('CommentActivityList (Round 14, 3.7)', () => {
  function activity(n: number): CommentActivity {
    return { post: post(n), viewerComments: [] }
  }

  it('renders the comment cards and loads more with the comment cursor', async () => {
    const initialPage: CursorPage<CommentActivity> = { entries: [{ cursor: cursorOf(9), item: activity(9) }], nextCursor: cursorOf(9) }
    mocks.loadMyCommentActivityPage.mockResolvedValueOnce({ ok: true, page: { entries: [{ cursor: cursorOf(4), item: activity(4) }], nextCursor: null } })
    render(<CommentActivityList initialPage={initialPage} />)

    fireEvent.click(screen.getByRole('button', { name: 'Load more comments' }))

    await waitFor(() => expect(screen.getAllByTestId('comment-activity').map((node) => node.textContent)).toEqual(['Post 9', 'Post 4']))
    expect(mocks.loadMyCommentActivityPage).toHaveBeenCalledWith({ cursor: cursorOf(9) })
    expect(screen.queryByRole('button', { name: 'Load more comments' })).not.toBeInTheDocument()
  })
})
