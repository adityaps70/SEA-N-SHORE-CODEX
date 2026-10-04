'use client'

import type { RefObject } from 'react'
import { loadMyActivityPostsPage, loadMyCommentActivityPage } from '../actions'
import type { CommentActivity } from '../queries'
import type { CursorPage, FeedCursor, FeedPost } from '../types'
import { CommentActivityCard } from './comment-activity-card'
import { PostCard } from './post-card'
import { useCursorList } from './use-cursor-list'

const postId = (post: FeedPost) => post.id
const commentActivityId = (activity: CommentActivity) => activity.post.id
const loadPosts = (cursor: FeedCursor) => loadMyActivityPostsPage({ cursor })
const loadComments = (cursor: FeedCursor) => loadMyCommentActivityPage({ cursor })

/**
 * The home feed's list footer (FeedList): "Load more" with infinite scroll, and "Try again" after a
 * failure. Shown only while there is a next page, so a short list looks exactly as before.
 */
function LoadMoreFooter({
  sentinelRef,
  cursor,
  loading,
  error,
  onLoadMore,
  label,
}: {
  sentinelRef: RefObject<HTMLDivElement | null>
  cursor: FeedCursor | null
  loading: boolean
  error: string
  onLoadMore: () => void
  label: string
}) {
  if (!cursor && !error) return null
  return (
    <div ref={sentinelRef} className="flex min-h-24 flex-col items-center justify-center gap-2 px-4 py-4 text-center" aria-live="polite">
      {error ? (
        <>
          <p role="alert" className="text-sm text-red-700">{error}</p>
          <button
            type="button"
            onClick={onLoadMore}
            className="min-h-10 rounded-full border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-900 hover:border-ocean-500 hover:text-ocean-700"
          >
            Try again
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={loading}
          onClick={onLoadMore}
          aria-label={label}
          className="min-h-11 rounded-xl border border-mist-200 bg-white px-5 text-sm font-semibold text-navy-900 shadow-sm hover:border-ocean-500 hover:text-ocean-700 disabled:opacity-60"
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  )
}

/** My Activities › Posts: the member's own posts, 20 at a time (Round 14, 3.7). */
export function ActivityPostList({ initialPage }: { initialPage: CursorPage<FeedPost> }) {
  const list = useCursorList({ initialPage, getId: postId, load: loadPosts, errorMessage: 'We could not load more posts.' })
  return (
    <div className="space-y-4">
      {list.entries.map(({ item }) => <PostCard key={item.id} post={item} />)}
      <LoadMoreFooter sentinelRef={list.sentinelRef} cursor={list.cursor} loading={list.loading} error={list.error} onLoadMore={() => { void list.loadMore() }} label="Load more posts" />
    </div>
  )
}

/** My Activities › Comments: posts the member commented on, 20 at a time (Round 14, 3.7). */
export function CommentActivityList({ initialPage }: { initialPage: CursorPage<CommentActivity> }) {
  const list = useCursorList({ initialPage, getId: commentActivityId, load: loadComments, errorMessage: 'We could not load more comments.' })
  return (
    <div className="space-y-4">
      {list.entries.map(({ item }) => <CommentActivityCard key={item.post.id} activity={item} />)}
      <LoadMoreFooter sentinelRef={list.sentinelRef} cursor={list.cursor} loading={list.loading} error={list.error} onLoadMore={() => { void list.loadMore() }} label="Load more comments" />
    </div>
  )
}
