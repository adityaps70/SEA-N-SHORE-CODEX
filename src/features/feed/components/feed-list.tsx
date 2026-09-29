'use client'

import { postLoadingPriority } from '../post-loading-priority'
import Link from 'next/link'
import { Fragment, useCallback, useEffect, useRef, useState, useTransition } from 'react'
import type { NetworkProfile } from '@/features/network/types'
import { loadFeedPage } from '../actions'
import type { FeedPage, FeedPost, PostCategory } from '../types'
import { FeedPeopleRow, peopleRowPositions } from './feed-people-row'
import { PostCard } from './post-card'

export function FeedList({
  initialPage,
  category,
  suggestions = [],
}: {
  initialPage: FeedPage
  category?: PostCategory
  /** People you may know (the desktop rail's data), shown as a swipe row inside the phone feed. */
  suggestions?: NetworkProfile[]
}) {
  const [canonicalPage, setCanonicalPage] = useState(initialPage)
  const [posts, setPosts] = useState(initialPage.posts)
  const [cursor, setCursor] = useState(initialPage.nextCursor)
  const [freshPosts, setFreshPosts] = useState<FeedPost[]>([])
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const sentinelRef = useRef<HTMLDivElement | null>(null)

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

  const loadMore = useCallback(() => {
    if (!cursor || pending) return
    setError('')
    startTransition(async () => {
      const result = await loadFeedPage({ category, cursor, limit: 12 })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setPosts((current) => {
        const seen = new Set(current.map((post) => post.id))
        return [...current, ...result.page.posts.filter((post) => !seen.has(post.id))]
      })
      setCursor(result.page.nextCursor)
    })
  }, [category, cursor, pending])

  useEffect(() => {
    if (!cursor || typeof IntersectionObserver === 'undefined') return
    const node = sentinelRef.current
    if (!node) return

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore()
    }, { rootMargin: '400px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [cursor, loadMore])

  useEffect(() => {
    let active = true
    let checking = false

    const checkForFreshPosts = async () => {
      if (checking) return
      checking = true
      try {
        const result = await loadFeedPage({ category, limit: 12 })
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
  }, [category])

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
          <PostCard post={post} flushOnPhones loadingPriority={postLoadingPriority(index)} />
          {peoplePositions.has(index) ? <FeedPeopleRow profiles={suggestions} /> : null}
        </Fragment>
      ))}
      {error ? <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 max-md:mx-4">{error}</p> : null}
      {cursor ? (
        <div ref={sentinelRef} className="flex justify-center pt-1" aria-label="Load more posts">
          <button
            type="button"
            disabled={pending}
            onClick={loadMore}
            className="min-h-11 rounded-xl border border-mist-200 bg-white px-5 text-sm font-semibold text-navy-900 shadow-sm hover:border-ocean-500 hover:text-ocean-700 disabled:opacity-60"
          >
            {pending ? 'Loading…' : 'Load more'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
