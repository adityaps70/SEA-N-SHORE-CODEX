'use client'

import { postLoadingPriority } from '../post-loading-priority'
import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { NetworkProfile } from '@/features/network/types'
import { loadFeedPage } from '../actions'
import type { FeedPage, FeedPost, PostCategory } from '../types'
import { FeedPeopleRow, peopleRowPositions } from './feed-people-row'
import { PostCard } from './post-card'

export type FeedListScope = {
  /** Only posts published in this community group. */
  groupId?: string
  /** Only posts carrying this (normalised) hashtag. */
  hashtag?: string
}

export function FeedList({
  initialPage,
  category,
  scope,
  suggestions = [],
  roleBadges,
}: {
  initialPage: FeedPage
  category?: PostCategory
  /** Group or hashtag feed; the open feed passes nothing. */
  scope?: FeedListScope
  /** People you may know (the desktop rail's data), shown as a swipe row inside the phone feed. */
  suggestions?: NetworkProfile[]
  /** Round 9C: a community's Posts tab passes its owner and moderators (by profile id) for a chip next to the author. */
  roleBadges?: Record<string, 'Owner' | 'Moderator'>
}) {
  const [canonicalPage, setCanonicalPage] = useState(initialPage)
  const [posts, setPosts] = useState(initialPage.posts)
  const [cursor, setCursor] = useState(initialPage.nextCursor)
  const [freshPosts, setFreshPosts] = useState<FeedPost[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  /** One request at a time: the observer can fire again before React re-renders. */
  const inFlightRef = useRef(false)
  /** After a failed page the observer stops auto-retrying; the member taps "Try again". */
  const failedRef = useRef(false)
  const groupId = scope?.groupId
  const hashtag = scope?.hashtag

  if (canonicalPage !== initialPage) {
    const canonicalIds = new Set(initialPage.posts.map((post) => post.id))
    setCanonicalPage(initialPage)
    setPosts((current) => [
      ...initialPage.posts,
      ...current.filter((post) => !canonicalIds.has(post.id)),
    ])
    setFreshPosts((current) => current.filter((post) => !canonicalIds.has(post.id)))
    setCursor((current) => current === canonicalPage.nextCursor ? initialPage.nextCursor : current)
  }

  const loadMore = useCallback(async () => {
    if (!cursor || inFlightRef.current) return
    inFlightRef.current = true
    failedRef.current = false
    setError('')
    setLoading(true)
    try {
      const result = await loadFeedPage({ category, ...(groupId ? { groupId } : {}), ...(hashtag ? { hashtag } : {}), cursor, limit: 12 })
      if (!result.ok) {
        failedRef.current = true
        setError(result.error)
        return
      }
      let added = 0
      setPosts((current) => {
        const seen = new Set(current.map((post) => post.id))
        const unseen = result.page.posts.filter((post) => !seen.has(post.id))
        added = unseen.length
        return unseen.length ? [...current, ...unseen] : current
      })
      // A page with nothing new (or a cursor that did not move) is the end: stop asking.
      const next = result.page.nextCursor
      const moved = next && (next.id !== cursor.id || next.createdAt !== cursor.createdAt)
      setCursor(moved && (added > 0 || result.page.posts.length > 0) ? next : null)
    } catch {
      failedRef.current = true
      setError('We could not load more posts.')
    } finally {
      inFlightRef.current = false
      setLoading(false)
    }
  }, [category, cursor, groupId, hashtag])

  // The observer reads the latest loader through a ref, so it is created once per cursor
  // instead of being torn down (and immediately re-fired) on every loading toggle.
  const loadMoreRef = useRef(loadMore)
  useEffect(() => { loadMoreRef.current = loadMore }, [loadMore])

  useEffect(() => {
    if (!cursor || typeof IntersectionObserver === 'undefined') return
    const node = sentinelRef.current
    if (!node) return

    const observer = new IntersectionObserver((entries) => {
      if (failedRef.current) return
      if (entries.some((entry) => entry.isIntersecting)) void loadMoreRef.current()
    }, { rootMargin: '600px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [cursor])

  useEffect(() => {
    let active = true
    let checking = false

    const checkForFreshPosts = async () => {
      if (checking) return
      checking = true
      try {
        const result = await loadFeedPage({ category, ...(groupId ? { groupId } : {}), ...(hashtag ? { hashtag } : {}), limit: 12 })
        if (!active || !result.ok) return
        setPosts((current) => {
          const seen = new Set(current.map((post) => post.id))
          const unseen = result.page.posts.filter((post) => !seen.has(post.id))
          setFreshPosts(unseen)
          return current
        })
      } finally {
        checking = false
      }
    }

    const interval = window.setInterval(() => { void checkForFreshPosts() }, 30_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [category, groupId, hashtag])

  function showFreshPosts() {
    setPosts((current) => {
      const seen = new Set(current.map((post) => post.id))
      return [...freshPosts.filter((post) => !seen.has(post.id)), ...current]
    })
    setFreshPosts([])
  }

  if (!posts.length) {
    return (
      <div>
        <div className="rounded-[var(--radius-card)] border border-dashed border-mist-100 bg-white px-5 py-12 text-center shadow-[var(--shadow-card)]">
          <p className="text-lg font-semibold text-navy-950">The maritime feed is ready for its first conversation.</p>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">Publish a professional update above or discover relevant maritime professionals in the network.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {/* Phones have no composer card on Home: the link opens the full-screen composer. */}
            <Link href="/home?compose=update" className="inline-flex min-h-10 items-center rounded-full bg-ocean-700 px-4 text-sm font-semibold text-white hover:bg-ocean-800 transition-colors md:hidden">Publish an update</Link>
            <a href="#feed-composer" className="max-md:hidden inline-flex min-h-10 items-center rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-navy-800 transition-colors">Publish an update</a>
            <Link href="/network" className="inline-flex min-h-10 items-center rounded-xl border border-mist-200 px-4 text-sm font-semibold text-navy-900 hover:border-ocean-300 hover:bg-mist-50 transition-colors">Explore Network</Link>
          </div>
        </div>
        {suggestions.length ? <div className="-mx-4 mt-2 md:hidden"><FeedPeopleRow profiles={suggestions} /></div> : null}
      </div>
    )
  }

  const peoplePositions = suggestions.length ? peopleRowPositions(posts.length) : new Set<number>()

  return (
    // Phones: posts run edge to edge with an 8px mist gap between them.
    <div className="space-y-4 max-md:-mx-4 max-md:space-y-2 max-md:bg-mist-100">
      {freshPosts.length ? (
        <div className="sticky top-20 z-10 flex justify-center max-md:top-2">
          <button
            type="button"
            onClick={showFreshPosts}
            className="min-h-10 rounded-full border border-ocean-200 bg-white px-4 text-sm font-semibold text-ocean-700 shadow-md hover:border-ocean-400"
          >
            {freshPosts.length} new {freshPosts.length === 1 ? 'post' : 'posts'}
          </button>
        </div>
      ) : null}
      {posts.map((post, index) => (
        <Fragment key={post.id}>
          <PostCard post={post} flushOnPhones loadingPriority={postLoadingPriority(index)} roleBadge={roleBadges?.[post.author.id]} />
          {peoplePositions.has(index) ? <FeedPeopleRow profiles={suggestions} /> : null}
        </Fragment>
      ))}
      {/* Fixed-height footer: loading, retry and the end state swap in place, so the page never jumps. */}
      <div ref={sentinelRef} className="flex min-h-24 flex-col items-center justify-center gap-2 px-4 py-4 text-center" aria-live="polite">
        {error ? (
          <>
            <p role="alert" className="text-sm text-red-700">{error}</p>
            <button
              type="button"
              onClick={() => { void loadMore() }}
              className="min-h-10 rounded-full border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-900 hover:border-ocean-500 hover:text-ocean-700"
            >
              Try again
            </button>
          </>
        ) : cursor ? (
          <button
            type="button"
            disabled={loading}
            onClick={() => { void loadMore() }}
            aria-label="Load more posts"
            className="min-h-11 rounded-xl border border-mist-200 bg-white px-5 text-sm font-semibold text-navy-900 shadow-sm hover:border-ocean-500 hover:text-ocean-700 disabled:opacity-60"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        ) : (
          <div data-testid="feed-end" className="flex flex-col items-center gap-2">
            <span className="inline-flex size-9 items-center justify-center rounded-full bg-teal-50 text-teal-700"><CheckCircle2 aria-hidden className="size-5" /></span>
            <p className="text-sm font-semibold text-navy-950">You&apos;re all caught up</p>
            {groupId || hashtag ? null : (<>
            <p className="max-w-sm text-xs leading-5 text-muted">Follow more people or join a community to see more maritime posts here.</p>
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <Link href="/network" className="inline-flex min-h-9 items-center rounded-full border border-mist-200 bg-white px-3.5 text-xs font-semibold text-navy-900 hover:border-ocean-300">Find people</Link>
              <Link href="/community" className="inline-flex min-h-9 items-center rounded-full border border-mist-200 bg-white px-3.5 text-xs font-semibold text-navy-900 hover:border-ocean-300">Join communities</Link>
            </div>
            </>)}
          </div>
        )}
      </div>
    </div>
  )
}
