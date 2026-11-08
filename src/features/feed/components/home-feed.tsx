'use client'

import Link from '@/components/navigation/intent-link'
import { CheckCircle2, Compass, Loader2 } from 'lucide-react'
import { Fragment, useCallback, useEffect, useRef, useState, useTransition } from 'react'
import type { NetworkProfile } from '@/features/network/types'
import { useSuggestionDeck } from '@/features/network/components/suggestion-deck'
import { useRealtimeAwarePoll } from '@/features/realtime/use-realtime-aware-poll'
import { countNewTopPosts, loadRecentFeedPage, loadTopFeedPage, setFeedMode } from '../actions'
import { usePostImpressions } from '../impressions/use-post-impressions'
import { postLoadingPriority } from '../post-loading-priority'
import type { FeedCursor, FeedMode, FeedPage, FeedPost, PostCategory, TopFeedState } from '../types'
import { FeedPeopleRow, peopleRowPositions } from './feed-people-row'
import { PostCard } from './post-card'
import { buttonClass } from '@/components/ui/interactive-styles'
import { cn } from '@/lib/cn'

/** "N new posts" asks the server for a count this often, only while the tab is visible. */
export const NEW_POSTS_POLL_MS = 60_000
/** Round ARCH (broadcast fix): a realtime "new post" hint re-asks the count at most once per this window. */
export { REALTIME_HINT_DEBOUNCE_MS as NEW_POSTS_HINT_DEBOUNCE_MS } from '@/features/realtime/use-realtime-aware-poll'
/** Who posting can reach this member's "N new posts": their network, which is exactly a new-post hint's audience. */
const NEW_POST_HINTS = ['feed.post_created', 'feed.post_reposted'] as const

function contentId(post: FeedPost) {
  return post.repostOf?.id ?? post.id
}

function appendUnique(current: FeedPost[], next: FeedPost[]) {
  const shown = new Set(current.map(contentId))
  const added = next.filter((post) => !shown.has(contentId(post)))
  return added.length ? [...current, ...added] : current
}

const STAGE_LABELS: Partial<Record<TopFeedState['stage'], string>> = {
  wider: 'Older posts you haven’t seen yet',
  explore: 'More from across Sea N Shore',
}

/** Round G: the feed switch at the top of Home: Top for you · Recent, remembered on the server. */
export function FeedModeSwitch({ mode, onChange, disabled }: { mode: FeedMode; onChange(mode: FeedMode): void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Sort the feed" className="mb-3 flex items-center gap-1 rounded-full border border-mist-100 bg-white p-1 shadow-[var(--shadow-card)] max-md:mx-4 max-md:mb-2 max-md:mt-1 md:w-fit">
      {(['top', 'recent'] as const).map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          disabled={disabled}
          onClick={() => { if (mode !== value) onChange(value) }}
          className="min-h-10 flex-1 rounded-full px-4 text-sm font-semibold text-navy-900 transition aria-checked:bg-navy-950 aria-checked:text-white hover:bg-mist-50 aria-checked:hover:bg-navy-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 disabled:opacity-60 md:flex-none"
        >
          {value === 'top' ? 'Top for you' : 'Recent'}
        </button>
      ))}
    </div>
  )
}

export function FeedSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-4 max-md:space-y-2">
      {[0, 1, 2].map((index) => (
        <div key={index} className="animate-pulse rounded-[var(--radius-card)] border border-mist-100 bg-white p-5 max-md:rounded-none max-md:border-x-0">
          <div className="flex items-center gap-3">
            <div className="size-11 rounded-2xl bg-mist-100" />
            <div className="flex-1 space-y-2"><div className="h-3 w-1/3 rounded bg-mist-100" /><div className="h-3 w-1/4 rounded bg-mist-100" /></div>
          </div>
          <div className="mt-4 space-y-2"><div className="h-3 rounded bg-mist-100" /><div className="h-3 w-5/6 rounded bg-mist-100" /></div>
        </div>
      ))}
    </div>
  )
}

function ColdStartCard() {
  return (
    <section aria-labelledby="cold-start-title" className="rounded-[var(--radius-card)] border border-ocean-100 bg-ocean-50/60 px-5 py-4 max-md:rounded-none max-md:border-x-0">
      <div className="flex items-start gap-3">
        <Compass aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ocean-700" />
        <div className="min-w-0">
          <h2 id="cold-start-title" className="text-sm font-semibold text-navy-950">Follow pages and join communities to improve your feed</h2>
          <p className="mt-1 text-sm leading-6 text-muted">Top for you learns from the people, pages and communities you follow and the posts you react to. Until then it shows the best recent posts from your part of the industry.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/organizations" className={cn(buttonClass({ variant: 'primary', size: 'sm' }), 'rounded-full')}>Find pages to follow</Link>
            <Link href="/community" className={cn(buttonClass({ variant: 'secondary', size: 'sm' }), 'rounded-full')}>Join communities</Link>
            <Link href="/network" className={cn(buttonClass({ variant: 'secondary', size: 'sm' }), 'rounded-full')}>Grow your network</Link>
          </div>
        </div>
      </div>
    </section>
  )
}

function CaughtUpCard({ onSwitchToRecent }: { onSwitchToRecent(): void }) {
  return (
    <section data-testid="feed-caught-up" aria-labelledby="caught-up-title" className="flex flex-col items-center gap-2 rounded-[var(--radius-card)] border border-mist-100 bg-white px-5 py-8 text-center shadow-[var(--shadow-card)] max-md:rounded-none max-md:border-x-0">
      <span className="inline-flex size-10 items-center justify-center rounded-full bg-teal-50 text-teal-700"><CheckCircle2 aria-hidden="true" className="size-5" /></span>
      <h2 id="caught-up-title" className="text-base font-semibold text-navy-950">You&apos;re all caught up</h2>
      <p className="max-w-md text-sm leading-6 text-muted">You&apos;ve seen the new posts from your network. Follow more pages, join a community or connect with people below to see more here.</p>
      <div className="flex flex-wrap justify-center gap-2 pt-1">
        <button type="button" onClick={onSwitchToRecent} className="inline-flex min-h-10 items-center rounded-full bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-navy-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500">See everything in Recent</button>
        <Link href="/organizations" className="inline-flex min-h-10 items-center rounded-full border border-mist-200 px-4 text-sm font-semibold text-navy-900 hover:border-ocean-300">Find pages</Link>
        <Link href="/community" className="inline-flex min-h-10 items-center rounded-full border border-mist-200 px-4 text-sm font-semibold text-navy-900 hover:border-ocean-300">Join communities</Link>
      </div>
    </section>
  )
}

/**
 * Round G: Home's feed when the new ranking is on. "Top for you" pages through a server snapshot
 * (loaded from the browser, so a reaction's page refresh never rebuilds it); "Recent" is newest
 * first with the "New since your last visit" divider. Posts count as seen after ≥50% is visible for 1 s.
 */
export function HomeFeed({
  initialMode,
  initialRecentPage,
  suggestions,
  debug = false,
  category,
}: {
  initialMode: FeedMode
  /** A category filter: newest first only (no switch). */
  category?: PostCategory
  /** Recent's first page, rendered on the server (null in Top for you, which loads in the browser). */
  initialRecentPage: FeedPage | null
  suggestions: NetworkProfile[]
  /** Admins only (?rankdebug=1): show each post's score parts. */
  debug?: boolean
}) {
  const [mode, setMode] = useState<FeedMode>(initialMode)
  const [posts, setPosts] = useState<FeedPost[]>(initialRecentPage?.posts ?? [])
  const [top, setTop] = useState<TopFeedState | null>(null)
  const [recentCursor, setRecentCursor] = useState<FeedCursor | null>(initialRecentPage?.nextCursor ?? null)
  const [dividerBefore, setDividerBefore] = useState<string | null>(initialRecentPage?.recent?.dividerBeforePostId ?? null)
  /** Where each later stage starts (post id → label), e.g. "Older posts you haven't seen yet". */
  const [stageStarts, setStageStarts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(initialMode === 'top')
  const [error, setError] = useState('')
  const [newCount, setNewCount] = useState(0)
  const [switching, startSwitching] = useTransition()
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const inFlightRef = useRef(false)
  const failedRef = useRef(false)
  /** Bumped when the list is replaced (mode switch, new posts): late answers for the old list are dropped. */
  const generationRef = useRef(0)
  const impressionRef = usePostImpressions()
  const peopleDeck = useSuggestionDeck(suggestions)

  const applyTopPage = useCallback((page: FeedPage, replace: boolean) => {
    const state = page.top ?? null
    setTop((previous) => {
      if (!replace && state && previous && previous.stage !== state.stage && STAGE_LABELS[state.stage] && page.posts[0]) {
        const firstId = page.posts[0].id
        setStageStarts((current) => ({ ...current, [firstId]: STAGE_LABELS[state.stage]! }))
      }
      return state
    })
    setPosts((current) => replace ? appendUnique([], page.posts) : appendUnique(current, page.posts))
  }, [])

  const loadTop = useCallback(async (replace: boolean) => {
    if (inFlightRef.current && !replace) return
    if (replace) generationRef.current += 1
    const generation = generationRef.current
    inFlightRef.current = true
    failedRef.current = false
    setError('')
    setLoading(true)
    try {
      const request = replace || !top
        ? { ...(debug ? { debug: true } : {}) }
        : { sessionId: top.sessionId, ...(top.nextPosition !== null ? { position: top.nextPosition } : {}), ...(debug ? { debug: true } : {}) }
      const result = await loadTopFeedPage(request)
      if (generation !== generationRef.current) return
      if (!result.ok) {
        failedRef.current = true
        setError(result.error)
        return
      }
      if (replace) setStageStarts({})
      applyTopPage(result.page, replace)
    } catch {
      failedRef.current = true
      setError('We could not load more posts.')
    } finally {
      inFlightRef.current = false
      setLoading(false)
    }
  }, [applyTopPage, debug, top])

  const loadRecent = useCallback(async (replace: boolean) => {
    if (!replace && (inFlightRef.current || !recentCursor)) return
    if (replace) generationRef.current += 1
    const generation = generationRef.current
    inFlightRef.current = true
    failedRef.current = false
    setError('')
    setLoading(true)
    try {
      const result = await loadRecentFeedPage({ ...(category ? { category } : {}), ...(replace || !recentCursor ? {} : { cursor: recentCursor }), limit: 12 })
      if (generation !== generationRef.current) return
      if (!result.ok) {
        failedRef.current = true
        setError(result.error)
        return
      }
      setPosts((current) => replace ? appendUnique([], result.page.posts) : appendUnique(current, result.page.posts))
      setRecentCursor(result.page.nextCursor)
      if (replace) setDividerBefore(result.page.recent?.dividerBeforePostId ?? null)
    } catch {
      failedRef.current = true
      setError('We could not load more posts.')
    } finally {
      inFlightRef.current = false
      setLoading(false)
    }
  }, [category, recentCursor])

  // Top for you: the first page loads in the browser.
  const startedRef = useRef(false)
  useEffect(() => {
    if (startedRef.current || initialMode !== 'top') return
    startedRef.current = true
    void loadTop(true)
  }, [initialMode, loadTop])

  const hasMore = mode === 'top' ? Boolean(top && top.nextPosition !== null) : Boolean(recentCursor)
  const loadMore = mode === 'top' ? () => loadTop(false) : () => loadRecent(false)
  const loadMoreRef = useRef(loadMore)
  useEffect(() => { loadMoreRef.current = loadMore })

  useEffect(() => {
    if (!hasMore || typeof IntersectionObserver === 'undefined') return
    const node = sentinelRef.current
    if (!node) return
    const observer = new IntersectionObserver((entries) => {
      if (failedRef.current) return
      if (entries.some((entry) => entry.isIntersecting)) void loadMoreRef.current()
    }, { rootMargin: '600px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, mode, posts.length])

  // "N new posts": a cheap count, never a page refetch. Round ARCH: asked on a realtime hint that someone in the
  // member's network posted (broadcast fix); the 60-second check runs only while the realtime socket is down
  // (Phase 5), with one catch-up check when it drops and when it comes back.
  const since = mode === 'top' ? top?.snapshotAt ?? null : posts[0]?.createdAt ?? null
  const sinceRef = useRef(since)
  useEffect(() => { sinceRef.current = since }, [since])
  const checkNewPosts = useCallback(() => {
    const current = sinceRef.current
    if (!current || document.visibilityState !== 'visible') return
    void countNewTopPosts({ since: current }).then((result) => {
      if (result.ok && sinceRef.current === current) setNewCount(result.count)
    })
  }, [])
  useRealtimeAwarePoll(checkNewPosts, { intervalMs: NEW_POSTS_POLL_MS, hintEventTypes: NEW_POST_HINTS, pauseWhileConnected: true, enabled: Boolean(since) })

  function showNewPosts() {
    setNewCount(0)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    void (mode === 'top' ? loadTop(true) : loadRecent(true))
  }

  function changeMode(next: FeedMode) {
    setMode(next)
    setPosts([])
    setTop(null)
    setRecentCursor(null)
    setDividerBefore(null)
    setStageStarts({})
    setNewCount(0)
    startSwitching(async () => {
      await setFeedMode(next)
    })
    void (next === 'top' ? loadTop(true) : loadRecent(true))
  }

  const peoplePositions = peopleRowPositions(posts.length)
  const firstPeoplePosition = Math.min(...peoplePositions)
  const caughtUp = mode === 'top' && Boolean(top?.caughtUp || (top && top.nextPosition === null))

  return (
    <div>
      {category ? null : <FeedModeSwitch mode={mode} onChange={changeMode} disabled={switching} />}
      <div className="space-y-4 max-md:-mx-4 max-md:space-y-2 max-md:bg-mist-100">
        {newCount > 0 ? (
          <div className="sticky top-20 z-10 flex justify-center max-md:top-2">
            <button type="button" onClick={showNewPosts} className="min-h-10 rounded-full border border-ocean-200 bg-white px-4 text-sm font-semibold text-ocean-700 shadow-md hover:border-ocean-400">
              {newCount} new {newCount === 1 ? 'post' : 'posts'}
            </button>
          </div>
        ) : null}
        {mode === 'top' && top?.coldStart ? <ColdStartCard /> : null}
        {!posts.length && loading ? <FeedSkeleton /> : null}
        {posts.map((post, index) => (
          <Fragment key={post.id}>
            {mode === 'recent' && dividerBefore === post.id ? (
              // Above: new since the last visit. Below: posts from before it, which the member may have seen.
              <p role="separator" data-testid="new-since-last-visit" className="flex items-center gap-3 px-4 text-xs font-semibold uppercase tracking-[.12em] text-ocean-700 before:h-px before:flex-1 before:bg-ocean-200 after:h-px after:flex-1 after:bg-ocean-200">
                New since your last visit ends here
              </p>
            ) : null}
            {stageStarts[post.id] ? (
              <p role="separator" className="flex items-center gap-3 px-4 text-xs font-semibold uppercase tracking-[.12em] text-muted before:h-px before:flex-1 before:bg-mist-200 after:h-px after:flex-1 after:bg-mist-200">
                {stageStarts[post.id]}
              </p>
            ) : null}
            <div ref={impressionRef(post.id)}>
              <PostCard post={post} flushOnPhones feedControls loadingPriority={postLoadingPriority(index)} />
            </div>
            {peoplePositions.has(index) ? <FeedPeopleRow deck={peopleDeck} showEmptyState={index === firstPeoplePosition} /> : null}
          </Fragment>
        ))}
        <div ref={sentinelRef} className="flex min-h-24 flex-col items-center justify-center gap-2 px-4 py-4 text-center" aria-live="polite">
          {error ? (
            <>
              <p role="alert" className="text-sm text-red-700">{error}</p>
              <button type="button" onClick={() => { void loadMore() }} className="min-h-10 rounded-full border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-900 hover:border-ocean-500 hover:text-ocean-700">Try again</button>
            </>
          ) : caughtUp ? (
            <CaughtUpCard onSwitchToRecent={() => changeMode('recent')} />
          ) : hasMore ? (
            <button type="button" disabled={loading} onClick={() => { void loadMore() }} aria-label="Load more posts" className="min-h-11 rounded-xl border border-mist-200 bg-white px-5 text-sm font-semibold text-navy-900 shadow-sm hover:border-ocean-500 hover:text-ocean-700 disabled:opacity-60">
              {loading ? <span className="inline-flex items-center gap-2"><Loader2 aria-hidden="true" className="size-4 animate-spin" />Loading…</span> : 'Load more'}
            </button>
          ) : !loading ? (
            <div data-testid="feed-end" className="flex flex-col items-center gap-2">
              <span className="inline-flex size-9 items-center justify-center rounded-full bg-teal-50 text-teal-700"><CheckCircle2 aria-hidden="true" className="size-5" /></span>
              <p className="text-sm font-semibold text-navy-950">You&apos;ve reached the end of Recent</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
