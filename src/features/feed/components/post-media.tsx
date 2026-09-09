'use client'

import { useEffect, useRef } from 'react'
import type { FeedMedia } from '../types'

export function PostMedia({
  media,
  authorName,
}: {
  media: FeedMedia
  authorName: string
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const isVideo = media.mimeType === 'video/mp4' || media.mimeType === 'video/webm'

  useEffect(() => {
    if (!isVideo) return
    const video = videoRef.current
    if (!video || typeof IntersectionObserver === 'undefined') return

    video.muted = true
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
        void video.play().catch(() => undefined)
      } else {
        video.pause()
      }
    }, { threshold: [0, 0.6, 1] })

    observer.observe(video)
    return () => observer.disconnect()
  }, [isVideo, media.signedUrl])

  if (!media.signedUrl) return null

  if (isVideo) {
    return (
      <div className="mt-4 overflow-hidden rounded-2xl border border-mist-100 bg-black">
        <video
          ref={videoRef}
          controls
          muted
          playsInline
          loop
          preload="metadata"
          src={media.signedUrl}
          className="block max-h-[80vh] w-full bg-black"
          aria-label={media.altText ?? `Video attached to ${authorName}'s post`}
        >
          Your browser does not support this video.
        </video>
      </div>
    )
  }

  return (
    <div className="mt-4 w-full overflow-hidden rounded-2xl border border-mist-100 bg-mist-50">
      {/* Signed post media is already access-controlled and should preserve its natural dimensions. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={media.signedUrl}
        alt={media.altText ?? `Image attached to ${authorName}'s post`}
        className="block h-auto w-full object-contain"
      />
    </div>
  )
}
