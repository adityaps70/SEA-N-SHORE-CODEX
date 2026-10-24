'use client'

import { RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAutoplayAllowed, useVideoPreload } from '@/lib/browser/data-saver'
import { createPostVideoPosterUpload } from '../actions'
import { uploadVideoPoster } from '../video-poster'

/**
 * Round H (H1): the feed's video player.
 *
 * - Poster: the frame stored next to the video (`<video>.poster.jpg`), so a video is no longer a
 *   black box before it plays. A video without one simply shows no poster.
 * - Failures: a load error, or a stall with no progress for VIDEO_STALL_MS, retries automatically
 *   after 2 s and then 6 s (new request each time). After that a visible "Tap to retry" button
 *   replaces the endless spinner.
 * - Backfill: when the post's author views a video that has no poster yet, their browser captures
 *   one from the same-origin copy and stores it (best effort, once per page).
 */
export const VIDEO_RETRY_DELAYS_MS = [2_000, 6_000] as const
export const VIDEO_STALL_MS = 15_000

export function feedVideoPosterUrl(videoUrl: string) {
  const [path, query] = videoUrl.split('?')
  if (!path?.startsWith('/api/feed-media/') || !/\.(mp4|webm)$/i.test(path)) return null
  return `${path.replace(/\.(mp4|webm)$/i, '.poster.jpg')}${query ? `?${query}` : ''}`
}

export function feedVideoStoragePath(videoUrl: string) {
  const path = videoUrl.split('?')[0] ?? ''
  if (!path.startsWith('/api/feed-media/')) return null
  return path.slice('/api/feed-media/'.length).split('/').map((segment) => decodeURIComponent(segment)).join('/')
}

function withAttempt(url: string, attempt: number) {
  if (!attempt) return url
  return `${url}${url.includes('?') ? '&' : '?'}attempt=${attempt}`
}

const posterAttempts = new Set<string>()

export function FeedVideo({
  src,
  label,
  canMakePoster = false,
  className = '',
}: {
  src: string
  label: string
  canMakePoster?: boolean
  /** The frame around the video (border, radius, edge-to-edge on phones). */
  className?: string
}) {
  const ref = useRef<HTMLVideoElement | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  const [posterMissing, setPosterMissing] = useState(false)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stallTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const posterUrl = feedVideoPosterUrl(src)
  // Round P3: no autoplay in Data saver, on mobile data or a slow network; Data saver also loads nothing until play.
  const autoplay = useAutoplayAllowed()
  const preload = useVideoPreload()

  // The poster is probed with an Image so a missing one can be noticed (only for the author).
  useEffect(() => {
    if (!posterUrl || !canMakePoster || typeof Image === 'undefined') return
    let cancelled = false
    const probe = new Image()
    probe.onerror = () => { if (!cancelled) setPosterMissing(true) }
    probe.src = posterUrl
    return () => { cancelled = true }
  }, [canMakePoster, posterUrl])

  useEffect(() => {
    if (!posterMissing || !canMakePoster) return
    const storagePath = feedVideoStoragePath(src)
    if (!storagePath || posterAttempts.has(storagePath)) return
    posterAttempts.add(storagePath)
    void uploadVideoPoster({
      videoStoragePath: storagePath,
      source: `${src.split('?')[0]}?source=poster`,
      createUpload: (input) => createPostVideoPosterUpload(input),
    })
  }, [canMakePoster, posterMissing, src])

  // Muted autoplay while at least 60% of the video is on screen, where autoplay is allowed; a video
  // that scrolls away pauses either way. Re-attached after a retry.
  useEffect(() => {
    const video = ref.current
    if (!video || typeof IntersectionObserver === 'undefined') return
    video.muted = true
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
        if (autoplay) void video.play()?.catch(() => undefined)
      } else {
        video.pause()
      }
    }, { threshold: [0, 0.6, 1] })
    observer.observe(video)
    return () => observer.disconnect()
  }, [attempt, autoplay, src])

  useEffect(() => () => {
    if (retryTimer.current) clearTimeout(retryTimer.current)
    if (stallTimer.current) clearTimeout(stallTimer.current)
  }, [])

  function clearStall() {
    if (stallTimer.current) clearTimeout(stallTimer.current)
    stallTimer.current = null
  }

  function fail() {
    clearStall()
    if (retryTimer.current) return
    const delay = VIDEO_RETRY_DELAYS_MS[attempt]
    if (delay === undefined) {
      setFailed(true)
      return
    }
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null
      setAttempt((current) => current + 1)
    }, delay)
  }

  function watchStall() {
    if (stallTimer.current) return
    stallTimer.current = setTimeout(() => {
      stallTimer.current = null
      fail()
    }, VIDEO_STALL_MS)
  }

  function retryNow() {
    setFailed(false)
    setAttempt((current) => current + 1)
  }

  return (
    <div className={`relative ${className}`.trim()}>
      <video
        key={attempt}
        ref={ref}
        controls
        muted
        playsInline
        loop
        preload={preload}
        src={withAttempt(src, attempt)}
        poster={posterUrl ?? undefined}
        className="block max-h-[80vh] w-full bg-black"
        aria-label={label}
        onError={fail}
        onStalled={watchStall}
        onWaiting={watchStall}
        onPlaying={clearStall}
        onTimeUpdate={clearStall}
        onLoadedData={clearStall}
      >
        Your browser does not support this video.
      </video>
      {failed ? (
        <div className="absolute inset-0 grid place-items-center bg-black/70 p-4 text-center">
          <div>
            <p className="text-sm font-semibold text-white">This video didn&apos;t load.</p>
            <button
              type="button"
              onClick={retryNow}
              className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-navy-950 hover:bg-mist-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              Tap to retry
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
