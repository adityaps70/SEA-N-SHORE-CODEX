'use client'

import { MessagesSquare, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { loadFeedPage } from '../actions'
import { loadOrganizationPostsTab, type OrganizationPostsTabResult } from '../organization-post-actions'
import type { FeedCursor, FeedPost } from '../types'
import { PostCard } from './post-card'
import { PostComposer } from './post-composer'

type ComposerContext = Extract<OrganizationPostsTabResult, { ok: true }>['composer']

type TabState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; posts: FeedPost[]; cursor: FeedCursor | null; composer: ComposerContext }

function mergePosts(current: FeedPost[], next: FeedPost[]) {
  const seen = new Set(current.map((post) => post.id))
  return [...current, ...next.filter((post) => !seen.has(post.id))]
}

function LoadingPosts() {
  return (
    <div role="status" aria-label="Loading posts" className="space-y-4">
      {[0, 1].map((index) => (
        <div key={index} className="rounded-[var(--radius-card)] border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)] sm:p-5">
          <div className="flex items-center gap-3">
            <div className="size-11 animate-pulse rounded-xl bg-mist-100" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3 w-40 max-w-full animate-pulse rounded bg-mist-100" />
              <div className="h-3 w-24 animate-pulse rounded bg-mist-50" />
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <div className="h-3 w-full animate-pulse rounded bg-mist-50" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-mist-50" />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading posts…</span>
    </div>
  )
}

/**
 * An organization's posts for its organization page: the posts published as the organization,
 * newest first, with "Show more" pagination. When the viewer may post as the organization
 * (checked again on the server) the composer is shown, preset to post as it.
 */
export function OrganizationPostsTab({
  companyId,
  companySlug,
  canPost,
  limit = 10,
}: {
  companyId: string
  companySlug: string
  /** The page's own permission check; the server confirms it before showing the composer. */
  canPost: boolean
  limit?: number
}) {
  const [state, setState] = useState<TabState>({ status: 'loading' })
  const [moreError, setMoreError] = useState('')
  const [loadingMore, startLoadingMore] = useTransition()
  const requestRef = useRef(0)

  const applyResult = useCallback((request: number, result: OrganizationPostsTabResult | null) => {
    if (requestRef.current !== request) return
    if (!result || !result.ok) {
      setState({ status: 'error', error: result?.error ?? 'We could not load this organization’s posts.' })
      return
    }
    setMoreError('')
    setState({ status: 'ready', posts: result.page.posts, cursor: result.page.nextCursor, composer: result.composer })
  }, [])

  const load = useCallback(() => {
    requestRef.current += 1
    const request = requestRef.current
    loadOrganizationPostsTab({ companyId, limit, includeComposer: canPost })
      .then((result) => applyResult(request, result))
      .catch(() => applyResult(request, null))
  }, [applyResult, canPost, companyId, limit])

  // First page (and again whenever the organization or permission changes).
  useEffect(load, [load])

  function retry() {
    setState({ status: 'loading' })
    load()
  }

  function showMore() {
    if (state.status !== 'ready' || !state.cursor || loadingMore) return
    const cursor = state.cursor
    setMoreError('')
    startLoadingMore(async () => {
      const result = await loadFeedPage({ companyId, cursor, limit }).catch(() => null)
      if (!result || !result.ok) {
        setMoreError(result?.error ?? 'We could not load more posts.')
        return
      }
      setState((current) => current.status === 'ready'
        ? { ...current, posts: mergePosts(current.posts, result.page.posts), cursor: result.page.nextCursor }
        : current)
    })
  }

  const composer = state.status === 'ready' ? state.composer : null

  return (
    <section
      aria-label="Organization posts"
      data-organization={companySlug}
      className="space-y-4"
    >
      {composer ? (
        <PostComposer
          profile={composer.profile}
          postingOrganizations={composer.organizations}
          defaultOrganizationId={composer.organization.id}
          onPosted={load}
        />
      ) : null}

      {state.status === 'loading' ? <LoadingPosts /> : null}

      {state.status === 'error' ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="min-w-0 flex-1">{state.error} Check your connection and try again.</span>
          <button
            type="button"
            onClick={retry}
            className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-red-200 bg-white px-4 font-semibold text-red-800 hover:bg-red-100"
          >
            <RefreshCw aria-hidden="true" className="size-4" /> Try again
          </button>
        </div>
      ) : null}

      {state.status === 'ready' && !state.posts.length ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-mist-200 bg-white px-5 py-10 text-center shadow-[var(--shadow-card)]">
          <div className="mx-auto grid size-11 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
            <MessagesSquare aria-hidden="true" className="size-5" />
          </div>
          <p className="mt-3 font-semibold text-navy-950">
            {composer ? `No posts from ${composer.organization.name} yet` : 'No posts from this organization yet'}
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted">
            {composer
              ? 'Share news, vacancies, safety notes or a welcome message. Posts you publish here show under the organization’s name in the feed.'
              : 'When this organization shares updates, they will appear here and in the feed of everyone who follows it.'}
          </p>
        </div>
      ) : null}

      {state.status === 'ready' && state.posts.length ? (
        <div className="space-y-4">
          {state.posts.map((post) => <PostCard key={post.id} post={post} />)}
        </div>
      ) : null}

      {moreError ? <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{moreError} Please try again.</p> : null}

      {state.status === 'ready' && state.cursor ? (
        <div className="flex justify-center pt-1">
          <button
            type="button"
            disabled={loadingMore}
            onClick={showMore}
            className="min-h-11 cursor-pointer rounded-xl border border-mist-200 bg-white px-5 text-sm font-semibold text-navy-900 shadow-sm hover:border-ocean-500 hover:text-ocean-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingMore ? 'Loading…' : 'Show more posts'}
          </button>
        </div>
      ) : null}
    </section>
  )
}
