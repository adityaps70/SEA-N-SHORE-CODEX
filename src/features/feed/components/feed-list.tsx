'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { loadFeedPage } from '../actions'
import type { FeedPage, FeedPost, PostCategory } from '../types'
import { PostCard } from './post-card'

export function FeedList({ initialPage, category }: { initialPage: FeedPage; category?: PostCategory }) {
  const [posts, setPosts] = useState(initialPage.posts)
  const [cursor, setCursor] = useState(initialPage.nextCursor)
  const [freshPosts, setFreshPosts] = useState<FeedPost[]>([])
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const sentinelRef = useRef<HTMLDivElement | null>(null)

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
      <div className="rounded-[var(--radius-card)] border border-dashed border-mist-100 bg-white px-5 py-12 text-center shadow-[var(--shadow-card)]">
        <p className="text-lg font-semibold text-navy-950">The maritime feed is ready for its first conversation.</p>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">Publish a professional update above or discover relevant maritime professionals in the network.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <a href="#feed-composer" className="inline-flex min-h-10 items-center rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white">Publish an update</a>
          <Link href="/network" className="inline-flex min-h-10 items-center rounded-xl border border-mist-100 px-4 text-sm font-semibold text-navy-900">Explore Network</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {freshPosts.length ? (
        <div className="sticky top-20 z-10 flex justify-center">
          <button
            type="button"
            onClick={showFreshPosts}
            className="min-h-10 rounded-full border border-ocean-200 bg-white px-4 text-sm font-semibold text-ocean-700 shadow-md hover:border-ocean-400"
          >
            {freshPosts.length} new {freshPosts.length === 1 ? 'post' : 'posts'}
          </button>
        </div>
      ) : null}
      {posts.map((post) => <PostCard key={post.id} post={post} />)}
      {error ? <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
      {cursor ? (
        <div ref={sentinelRef} className="flex justify-center pt-1" aria-label="Load more posts">
          <button
            type="button"
            disabled={pending}
            onClick={loadMore}
            className="min-h-11 rounded-xl border border-mist-100 bg-white px-5 text-sm font-semibold text-navy-900 shadow-sm hover:border-ocean-500 hover:text-ocean-700 disabled:opacity-60"
          >
            {pending ? 'Loading…' : 'Load more'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
