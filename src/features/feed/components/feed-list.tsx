'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { loadFeedPage } from '../actions'
import type { FeedPage, PostCategory } from '../types'
import { PostCard } from './post-card'

export function FeedList({ initialPage, category }: { initialPage: FeedPage; category?: PostCategory }) {
  const [posts, setPosts] = useState(initialPage.posts)
  const [cursor, setCursor] = useState(initialPage.nextCursor)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  function loadMore() {
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
  }

  if (!posts.length) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-mist-100 bg-white px-5 py-12 text-center shadow-[var(--shadow-card)]">
        <p className="text-lg font-semibold text-navy-950">The maritime feed is ready for its first conversation.</p>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">Publish a professional update above, discover people in the network, or explore Sea N Shore communities.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <a href="#feed-composer" className="inline-flex min-h-10 items-center rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white">Publish an update</a>
          <Link href="/network" className="inline-flex min-h-10 items-center rounded-xl border border-mist-100 px-4 text-sm font-semibold text-navy-900">Explore Network</Link>
          <Link href="/community" className="inline-flex min-h-10 items-center rounded-xl border border-mist-100 px-4 text-sm font-semibold text-navy-900">Visit Community</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {posts.map((post) => <PostCard key={post.id} post={post} />)}
      {error ? <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
      {cursor ? (
        <div className="flex justify-center pt-1">
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
