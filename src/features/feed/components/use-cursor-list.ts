'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { appendCursorPage, mergeRefreshedFirstPage, sameFeedCursor, type CursorListState } from '../cursor-page'
import type { CursorPage, FeedCursor } from '../types'

export type CursorPageResult<T> = { ok: true; page: CursorPage<T> } | { ok: false; error: string }

/**
 * Round 14 (3.7): keyset "Load more" for a server-rendered first page, the way the home feed's
 * FeedList works: one request at a time, an IntersectionObserver near the end of the list (600px
 * ahead), no automatic retry after a failure (the member taps "Try again"), and a re-rendered first
 * page (after an action revalidates the route) merged with the pages already loaded.
 */
export function useCursorList<T>({
  initialPage,
  getId,
  load,
  errorMessage,
}: {
  initialPage: CursorPage<T>
  getId: (item: T) => string
  load: (cursor: FeedCursor) => Promise<CursorPageResult<T>>
  errorMessage: string
}) {
  const [firstPage, setFirstPage] = useState(initialPage)
  const [state, setState] = useState<CursorListState<T>>({ entries: initialPage.entries, cursor: initialPage.nextCursor })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const inFlightRef = useRef(false)
  const failedRef = useRef(false)

  if (firstPage !== initialPage) {
    setFirstPage(initialPage)
    setState((current) => mergeRefreshedFirstPage(current, firstPage, initialPage, getId))
  }

  const cursor = state.cursor

  const loadMore = useCallback(async () => {
    if (!cursor || inFlightRef.current) return
    inFlightRef.current = true
    failedRef.current = false
    setError('')
    setLoading(true)
    try {
      const result = await load(cursor)
      if (!result.ok) {
        failedRef.current = true
        setError(result.error)
        return
      }
      // Appended only while the list still ends where this page was requested.
      setState((current) => sameFeedCursor(current.cursor, cursor) ? appendCursorPage(current, cursor, result.page, getId) : current)
    } catch {
      failedRef.current = true
      setError(errorMessage)
    } finally {
      inFlightRef.current = false
      setLoading(false)
    }
  }, [cursor, errorMessage, getId, load])

  // The observer reads the latest loader through a ref, so it is created once per cursor.
  const loadMoreRef = useRef(loadMore)
  useEffect(() => { loadMoreRef.current = loadMore }, [loadMore])

  useEffect(() => {
    if (!cursor || typeof IntersectionObserver === 'undefined') return
    const node = sentinelRef.current
    if (!node) return
    const observer = new IntersectionObserver((observed) => {
      if (failedRef.current) return
      if (observed.some((entry) => entry.isIntersecting)) void loadMoreRef.current()
    }, { rootMargin: '600px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [cursor])

  return { entries: state.entries, cursor, loading, error, loadMore, sentinelRef }
}
