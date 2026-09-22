'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { FeedMedia } from '../types'

function orderedMedia(value: FeedMedia | FeedMedia[]) {
  return (Array.isArray(value) ? value : [value])
    .filter((item) => Boolean(item.signedUrl))
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
}

function imageGridClass(count: number, index: number) {
  if (count === 1) return ''
  if (count === 2) return 'h-72 sm:h-96'
  if (count === 3 && index === 0) return 'row-span-2 h-full'
  return 'h-48 sm:h-56'
}

function PdfDocumentCarousel({ media }: { media: FeedMedia }) {
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, media.pageCount ?? 1)
  const url = media.signedUrl

  if (!url) return null

  const pageUrl = `${url}#page=${page}&toolbar=0&navpanes=0&scrollbar=0&view=FitH`

  return (
    <section
      className="relative mt-4 overflow-hidden rounded-2xl border border-mist-100 bg-mist-50"
      aria-label="Document carousel"
    >
      <div className="relative flex min-h-[34rem] items-center justify-center bg-mist-50 sm:min-h-[42rem]">
        <iframe
          key={page}
          src={pageUrl}
          title={`Document page ${page} of ${pageCount}`}
          className="block h-[34rem] w-full border-0 bg-white sm:h-[42rem]"
        />

        <span className="pointer-events-none absolute right-3 top-3 z-10 rounded-full bg-navy-950/80 px-3 py-1.5 text-xs font-semibold text-white shadow-sm backdrop-blur-sm">
          {page} / {pageCount}
        </span>

        <button
          type="button"
          aria-label="Previous slide"
          disabled={page <= 1}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
          className="absolute left-3 top-1/2 z-10 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/95 text-navy-950 shadow-lg ring-1 ring-black/5 transition hover:scale-105 hover:bg-white disabled:pointer-events-none disabled:opacity-0"
        >
          <ChevronLeft aria-hidden="true" className="size-6" />
        </button>

        <button
          type="button"
          aria-label="Next slide"
          disabled={page >= pageCount}
          onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
          className="absolute right-3 top-1/2 z-10 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/95 text-navy-950 shadow-lg ring-1 ring-black/5 transition hover:scale-105 hover:bg-white disabled:pointer-events-none disabled:opacity-0"
        >
          <ChevronRight aria-hidden="true" className="size-6" />
        </button>
      </div>
    </section>
  )
}

function PhotoGallery({ media, authorName }: { media: FeedMedia[]; authorName: string }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const visible = media.slice(0, 4)
  const overflow = Math.max(0, media.length - visible.length)
  const gridClass = media.length === 1
    ? 'grid-cols-1'
    : media.length === 2
      ? 'grid-cols-2'
      : 'grid-cols-2'

  function open(index: number) {
    setActiveIndex(index)
  }

  const active = activeIndex == null ? null : media[activeIndex] ?? null

  useEffect(() => {
    if (activeIndex == null) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveIndex(null)
      if (event.key === 'ArrowLeft') setActiveIndex((current) => current == null ? null : Math.max(0, current - 1))
      if (event.key === 'ArrowRight') setActiveIndex((current) => current == null ? null : Math.min(media.length - 1, current + 1))
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [activeIndex, media.length])

  if (media.length === 1) {
    const item = media[0]
    if (!item?.signedUrl) return null
    return (
      <button type="button" onClick={() => open(0)} className="mt-4 block w-full overflow-hidden rounded-2xl border border-mist-100 bg-mist-50 text-left">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.signedUrl}
          alt={item.altText ?? `Image attached to ${authorName}'s post`}
          className="block h-auto w-full object-contain"
        />
      </button>
    )
  }

  return (
    <>
      <div className={`mt-4 grid ${gridClass} gap-0.5 overflow-hidden rounded-2xl border border-mist-100 bg-mist-100 ${media.length === 3 ? 'grid-rows-2' : ''}`}>
        {visible.map((item, index) => (
          <button
            key={item.storagePath}
            type="button"
            onClick={() => open(index)}
            aria-label={index === 3 && overflow > 0 ? `View all ${media.length} photos` : `Open photo ${index + 1} of ${media.length}`}
            className={`relative min-w-0 overflow-hidden bg-white ${imageGridClass(media.length, index)}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.signedUrl ?? ''}
              alt={item.altText ?? `Photo ${index + 1} attached to ${authorName}'s post`}
              className="h-full w-full object-cover"
            />
            {index === 3 && overflow > 0 ? (
              <span className="absolute inset-0 grid place-items-center bg-navy-950/55 text-3xl font-semibold text-white">+{overflow}</span>
            ) : null}
          </button>
        ))}
      </div>

      {active?.signedUrl ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Photo ${(activeIndex ?? 0) + 1} of ${media.length}`}
          className="fixed inset-0 z-[180] grid place-items-center bg-navy-950/90 p-4"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setActiveIndex(null) }}
        >
          <button type="button" aria-label="Close photo viewer" onClick={() => setActiveIndex(null)} className="absolute right-4 top-4 grid size-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20">
            <X aria-hidden="true" className="size-5" />
          </button>
          {media.length > 1 ? (
            <button type="button" aria-label="Previous photo" disabled={(activeIndex ?? 0) <= 0} onClick={() => setActiveIndex((current) => current == null ? null : Math.max(0, current - 1))} className="absolute left-3 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30 sm:left-6">
              <ChevronLeft aria-hidden="true" className="size-6" />
            </button>
          ) : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={active.signedUrl} alt={active.altText ?? `Photo attached to ${authorName}'s post`} className="max-h-[88vh] max-w-[92vw] object-contain" />
          {media.length > 1 ? (
            <button type="button" aria-label="Next photo" disabled={(activeIndex ?? 0) >= media.length - 1} onClick={() => setActiveIndex((current) => current == null ? null : Math.min(media.length - 1, current + 1))} className="absolute right-3 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30 sm:right-6">
              <ChevronRight aria-hidden="true" className="size-6" />
            </button>
          ) : null}
          <span className="absolute bottom-4 rounded-full bg-black/40 px-3 py-1.5 text-sm font-semibold text-white">
            {(activeIndex ?? 0) + 1} / {media.length}
          </span>
        </div>
      ) : null}
    </>
  )
}

export function PostMedia({
  media,
  authorName,
}: {
  media: FeedMedia | FeedMedia[]
  authorName: string
}) {
  const items = useMemo(() => orderedMedia(media), [media])
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const first = items[0]
  const isVideo = first?.mimeType === 'video/mp4' || first?.mimeType === 'video/webm'

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
  }, [isVideo, first?.signedUrl])

  if (!first?.signedUrl) return null

  if (first.mimeType === 'application/pdf') {
    return <PdfDocumentCarousel key={first.storagePath} media={first} />
  }

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
          src={first.signedUrl}
          className="block max-h-[80vh] w-full bg-black"
          aria-label={first.altText ?? `Video attached to ${authorName}'s post`}
        >
          Your browser does not support this video.
        </video>
      </div>
    )
  }

  const images = items.filter((item) => item.mimeType.startsWith('image/'))
  return images.length ? <PhotoGallery media={images} authorName={authorName} /> : null
}
