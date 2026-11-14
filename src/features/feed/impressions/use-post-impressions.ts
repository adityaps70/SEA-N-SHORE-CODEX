'use client'

import { useCallback, useEffect, useRef } from 'react'
import { IMPRESSION_DRAIN_WAIT_MS, IMPRESSION_RETRY_MAX_MS, IMPRESSION_VISIBLE_RATIO, ImpressionTracker, browserImpressionTransport } from './impression-tracker'

/**
 * Round H (H1): shared by every feed on the page and across client navigations. When a tracker
 * gives up (signed out, refused, or failing), the next feed waits instead of starting over.
 */
let pausedUntil = 0
/** Round CAP: the live trackers, so a new feed visit can drain them first. */
const liveTrackers = new Set<ImpressionTracker>()

/**
 * Round CAP (batched impressions): send what every feed on the page has queued and wait (at most
 * IMPRESSION_DRAIN_WAIT_MS) before a new visit asks for posts, so "no repeats" sees everything just seen.
 */
export async function flushPendingImpressions(waitMs = IMPRESSION_DRAIN_WAIT_MS) {
  if (!liveTrackers.size) return
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    Promise.all([...liveTrackers].map((tracker) => tracker.drain())),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, waitMs) }),
  ])
  if (timer !== undefined) clearTimeout(timer)
}

export function impressionsPaused(now = Date.now()) {
  return now < pausedUntil
}

export function resetImpressionPauseForTests() {
  pausedUntil = 0
}

/**
 * Round G: gives each feed post a ref callback; the post counts as seen after ≥50% of it is
 * visible for ≥1 s. Queued ids are flushed every 15-30 s (Round CAP) and always on pagehide / tab hidden.
 */
export function usePostImpressions(enabled = true) {
  const trackerRef = useRef<ImpressionTracker | null>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const elementsRef = useRef(new Map<string, Element>())
  const refCallbacks = useRef(new Map<string, (element: Element | null) => void>())

  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === 'undefined' || impressionsPaused()) return
    const tracker = new ImpressionTracker(browserImpressionTransport(), undefined, (reason) => {
      pausedUntil = Date.now() + (reason === 'refused' ? 60 * 60_000 : IMPRESSION_RETRY_MAX_MS)
    }, () => document.visibilityState === 'hidden')
    trackerRef.current = tracker
    liveTrackers.add(tracker)
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const postId = (entry.target as HTMLElement).dataset.impressionPostId
        if (!postId) continue
        // A tall post can never be 50% visible on a small screen: count it when it fills half the viewport.
        const viewportShare = entry.rootBounds ? entry.intersectionRect.height / entry.rootBounds.height : 0
        tracker.visibility(postId, Math.max(entry.intersectionRatio, viewportShare >= IMPRESSION_VISIBLE_RATIO ? 1 : 0))
      }
    }, { threshold: [0, 0.25, IMPRESSION_VISIBLE_RATIO, 0.75, 1] })
    observerRef.current = observer
    for (const element of elementsRef.current.values()) observer.observe(element)

    const onHide = () => tracker.flushWithBeacon()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') tracker.flushWithBeacon()
    }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
      tracker.flushWithBeacon()
      liveTrackers.delete(tracker)
      observer.disconnect()
      tracker.dispose()
      observerRef.current = null
      trackerRef.current = null
    }
  }, [enabled])

  /** A stable ref callback per post id. */
  return useCallback((postId: string) => {
    let callback = refCallbacks.current.get(postId)
    if (!callback) {
      callback = (element: Element | null) => {
        const previous = elementsRef.current.get(postId)
        if (previous && previous !== element) {
          observerRef.current?.unobserve(previous)
          elementsRef.current.delete(postId)
          trackerRef.current?.forget(postId)
        }
        if (element) {
          ;(element as HTMLElement).dataset.impressionPostId = postId
          elementsRef.current.set(postId, element)
          observerRef.current?.observe(element)
        }
      }
      refCallbacks.current.set(postId, callback)
    }
    return callback
  }, [])
}
