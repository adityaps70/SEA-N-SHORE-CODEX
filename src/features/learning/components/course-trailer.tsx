'use client'

import { useSyncExternalStore, type ReactNode } from 'react'
import { useVideoPreload } from '@/lib/browser/data-saver'
import { StreamableVideo } from './streamable-video'
import type { VideoStream } from './use-hls-stream'

/**
 * Learning round E (E3): the course page lays out the trailer twice (phone header and desktop hero), but only one
 * `<video>` is ever rendered: the slot that matches the screen. The other slot shows its fallback (the cover), so
 * the browser fetches the trailer's metadata once. The trailer has no download button or remote playback.
 */

const PHONE_QUERY = '(max-width: 767px)'

function subscribe(callback: () => void) {
  const query = window.matchMedia?.(PHONE_QUERY)
  query?.addEventListener?.('change', callback)
  return () => query?.removeEventListener?.('change', callback)
}

function isPhone() {
  return window.matchMedia?.(PHONE_QUERY).matches ?? false
}

export function CourseTrailer({
  slot,
  src,
  stream = null,
  poster,
  label,
  className,
  fallback = null,
}: {
  slot: 'phone' | 'desktop'
  src: string
  /** Round P3: the trailer's ready rendition (HLS); `src` is then its signed 720p MP4. */
  stream?: VideoStream | null
  poster?: string
  label: string
  className?: string
  /** Shown in the slot that does not play the trailer (and before the page hydrates). */
  fallback?: ReactNode
}) {
  // null on the server: neither slot renders the video until the screen size is known.
  const phone = useSyncExternalStore<boolean | null>(subscribe, isPhone, () => null)
  const active = phone !== null && (slot === 'phone') === phone
  // Round P3: in Data saver the trailer loads nothing until it is played.
  const preload = useVideoPreload()
  if (!active) return <>{fallback}</>
  return (
    <StreamableVideo
      controls
      controlsList="nodownload noremoteplayback"
      disableRemotePlayback
      onContextMenu={(event) => event.preventDefault()}
      preload={preload}
      src={src}
      stream={stream}
      poster={poster}
      aria-label={label}
      className={className}
    />
  )
}
