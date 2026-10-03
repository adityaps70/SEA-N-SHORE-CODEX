'use client'

import { MediaImage } from '@/components/ui/media-image'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, UsersRound, X } from 'lucide-react'
import { renderPdfPage } from '../pdf-page-renderer'
import { removeMyPhotoTag } from '../photo-tag-actions'
import type { FeedMedia, FeedPhotoTag } from '../types'
import { initials, profileHref } from './author-avatar'

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

/**
 * `flush`: the Home feed / post page phone layout (round 8) — media runs edge to edge below md
 * (the card body has 16px side padding, 20px from sm). Desktop and tablet are unchanged.
 */
const FLUSH_CLASS = 'max-sm:-mx-4 sm:max-md:-mx-5 max-md:rounded-none max-md:border-x-0'
const FLUSH_WIDTH_CLASS = 'max-sm:w-[calc(100%+2rem)] sm:max-md:w-[calc(100%+2.5rem)]'

function PdfDocumentCarousel({ media, flush = false }: { media: FeedMedia; flush?: boolean }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null)
  const [rendering, setRendering] = useState(true)
  const [renderError, setRenderError] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const pageCount = Math.max(1, media.pageCount ?? 1)
  const url = media.signedUrl
  const documentTitle = (media.fileName || 'Document').replace(/\.pdf$/i, '').trim() || 'Document'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !url) return

    let active = true
    setRendering(true)
    setRenderError(false)

    void renderPdfPage(canvas, url, page)
      .then((size) => {
        if (!active) return
        setPageSize(size)
        setRendering(false)
      })
      .catch(() => {
        if (!active) return
        setRenderError(true)
        setRendering(false)
      })

    return () => {
      active = false
    }
  }, [page, url])

  if (!url) return null

  function previousPage() {
    setPage((current) => Math.max(1, current - 1))
  }

  function nextPage() {
    setPage((current) => Math.min(pageCount, current + 1))
  }

  function onTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0]
    if (!touch) return
    touchStartRef.current = { x: touch.clientX, y: touch.clientY }
  }

  function onTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    const start = touchStartRef.current
    const touch = event.changedTouches[0]
    touchStartRef.current = null
    if (!start || !touch) return

    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    const horizontal = Math.abs(deltaX) >= 48 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2
    if (!horizontal) return

    if (deltaX < 0) nextPage()
    else previousPage()
  }

  function onWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (Math.abs(event.deltaX) < 40 || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
    event.preventDefault()
    if (event.deltaX > 0) nextPage()
    else previousPage()
  }

  const aspectRatio = pageSize ? `${pageSize.width} / ${pageSize.height}` : '1 / 1.4142'

  return (
    <section
      className={`mt-4 overflow-hidden rounded-2xl border border-mist-100 bg-mist-50 ${flush ? FLUSH_CLASS : ''}`}
      aria-label="Document carousel"
    >
      <div
        data-testid="document-page-stage"
        className="relative w-full touch-pan-y overflow-hidden bg-mist-50"
        style={{ aspectRatio }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onWheel={onWheel}
      >
        <canvas
          key={page}
          ref={canvasRef}
          role="img"
          aria-label={`Document page ${page} of ${pageCount}`}
          className="absolute inset-0 block h-full w-full bg-white"
        />

        {rendering ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-mist-50/70" aria-hidden="true">
            <span className="size-7 animate-spin rounded-full border-2 border-mist-200 border-t-ocean-700" />
          </div>
        ) : null}

        {renderError ? (
          <div className="absolute inset-0 grid place-items-center bg-white px-6 text-center">
            <p className="text-sm font-semibold text-muted">This page could not be previewed.</p>
          </div>
        ) : null}

        <span className="pointer-events-none absolute left-3 top-3 z-10 max-w-[70%] truncate rounded-lg bg-black/75 px-3 py-2 text-sm font-semibold text-white shadow-sm backdrop-blur-sm">
          {documentTitle} · {pageCount} {pageCount === 1 ? 'page' : 'pages'}
        </span>

        <span className="pointer-events-none absolute right-3 top-3 z-10 rounded-full bg-black/75 px-3 py-1.5 text-xs font-semibold text-white shadow-sm backdrop-blur-sm">
          {page} / {pageCount}
        </span>

        <button
          type="button"
          aria-label="Previous slide"
          disabled={page <= 1}
          onClick={previousPage}
          className="absolute left-3 top-1/2 z-10 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-black/80 text-white shadow-lg transition hover:bg-black disabled:pointer-events-none disabled:opacity-0"
        >
          <ChevronLeft aria-hidden="true" className="size-7" />
        </button>

        <button
          type="button"
          aria-label="Next slide"
          disabled={page >= pageCount}
          onClick={nextPage}
          className="absolute right-3 top-1/2 z-10 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-black/80 text-white shadow-lg transition hover:bg-black disabled:pointer-events-none disabled:opacity-0"
        >
          <ChevronRight aria-hidden="true" className="size-7" />
        </button>
      </div>
    </section>
  )
}

type PhotoLoading = {
  /** `eager` for the first posts on screen; everything below stays lazy. */
  loading?: 'eager' | 'lazy'
  /** Given to the first photo of the very first post on screen. */
  fetchPriority?: 'high'
}

/** Photos are shown at the card's width: full width on phones, the 640px column on larger screens. */
const POST_IMAGE_SIZES = '(max-width: 768px) 100vw, 640px'
const GRID_IMAGE_SIZES = '(max-width: 768px) 50vw, 320px'
/**
 * Most post images are designed graphics (cards, posters) whose small logos and fine text go soft
 * at the optimizer's default quality 75; 90 is listed in next.config.ts `images.qualities`.
 */
const POST_IMAGE_QUALITY = 90

function tagKey(tag: Pick<FeedPhotoTag, 'mediaId' | 'profileId'>) {
  return `${tag.mediaId}:${tag.profileId}`
}

/**
 * The people tagged in the photo open in the lightbox (round 9B). Every row offers
 * "Remove my tag": the server only removes it for the tagged person (or the post author),
 * so the viewer needs no profile id on the client.
 */
function LightboxPeoplePanel({ postId, tags, onRemoved }: {
  postId?: string
  tags: FeedPhotoTag[]
  onRemoved(tag: FeedPhotoTag): void
}) {
  const [error, setError] = useState('')
  const [pendingKey, setPendingKey] = useState<string | null>(null)

  async function remove(tag: FeedPhotoTag) {
    if (!postId || pendingKey) return
    setError('')
    setPendingKey(tagKey(tag))
    try {
      const result = await removeMyPhotoTag({ postId, mediaId: tag.mediaId, profileId: tag.profileId })
      if (result.ok) onRemoved(tag)
      else setError(result.error)
    } catch {
      setError('We could not remove this tag. Please try again.')
    } finally {
      setPendingKey(null)
    }
  }

  return (
    <section
      aria-label="People in this photo"
      className="absolute right-4 top-[4.25rem] z-10 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-mist-100 bg-white text-navy-950 shadow-2xl"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <h3 className="border-b border-mist-100 px-4 py-2.5 text-sm font-semibold">In this photo</h3>
      {tags.length ? (
        <ul className="max-h-64 divide-y divide-mist-100 overflow-y-auto">
          {tags.map((tag) => (
            <li key={tagKey(tag)} className="flex items-center gap-3 px-3 py-2">
              <span className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-mist-100 text-xs font-semibold text-navy-950">
                {tag.avatarUrl ? (
                  <MediaImage avatar src={tag.avatarUrl} alt="" fill sizes="36px" className="object-cover" fallback={initials(tag.fullName)} />
                ) : initials(tag.fullName)}
              </span>
              <Link href={profileHref(tag.slug)} className="min-w-0 flex-1 truncate text-sm font-semibold text-navy-950 hover:text-ocean-700 hover:underline">
                {tag.fullName}
              </Link>
              {postId ? (
                <button
                  type="button"
                  onClick={() => { void remove(tag) }}
                  disabled={pendingKey !== null}
                  aria-label={`Remove my tag (${tag.fullName})`}
                  className="min-h-8 shrink-0 rounded-lg border border-mist-200 px-2 text-xs font-semibold text-navy-950 hover:bg-mist-50 disabled:opacity-50"
                >
                  {pendingKey === tagKey(tag) ? 'Removing…' : 'Remove my tag'}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-4 text-sm text-muted">No one is tagged in this photo.</p>
      )}
      {error ? <p role="alert" className="border-t border-mist-100 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</p> : null}
    </section>
  )
}

function PhotoLightbox({ media, activeIndex, authorName, postId, photoTags, onClose, onNavigate }: {
  media: FeedMedia[]
  activeIndex: number
  authorName: string
  postId?: string
  photoTags: FeedPhotoTag[]
  onClose(): void
  onNavigate(index: number): void
}) {
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [removedKeys, setRemovedKeys] = useState<string[]>([])
  const active = media[activeIndex]
  if (!active?.signedUrl) return null

  const currentTags = active.id
    ? photoTags.filter((tag) => tag.mediaId === active.id && !removedKeys.includes(tagKey(tag)))
    : []

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${activeIndex + 1} of ${media.length}`}
      className="fixed inset-0 z-[180] grid place-items-center bg-navy-950/90 p-4"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="absolute right-4 top-4 flex items-center gap-2">
        {photoTags.length ? (
          <button
            type="button"
            aria-label={`People in this photo (${currentTags.length})`}
            aria-expanded={peopleOpen}
            onClick={() => setPeopleOpen((open) => !open)}
            className={`relative grid size-11 place-items-center rounded-full text-white ${peopleOpen ? 'bg-white/30' : 'bg-white/10 hover:bg-white/20'}`}
          >
            <UsersRound aria-hidden="true" className="size-5" />
            <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-teal-500 px-1 text-[11px] font-bold leading-5 text-navy-950">
              {currentTags.length}
            </span>
          </button>
        ) : null}
        <button type="button" aria-label="Close photo viewer" onClick={onClose} className="grid size-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20">
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>
      {peopleOpen && active.id ? (
        <LightboxPeoplePanel
          key={active.id}
          postId={postId}
          tags={currentTags}
          onRemoved={(tag) => setRemovedKeys((keys) => [...keys, tagKey(tag)])}
        />
      ) : null}
      {media.length > 1 ? (
        <button type="button" aria-label="Previous photo" disabled={activeIndex <= 0} onClick={() => onNavigate(Math.max(0, activeIndex - 1))} className="absolute left-3 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30 sm:left-6">
          <ChevronLeft aria-hidden="true" className="size-6" />
        </button>
      ) : null}
      <MediaImage
        src={active.signedUrl}
        alt={active.altText ?? `Photo attached to ${authorName}'s post`}
        width={2048}
        height={1536}
        sizes="100vw"
        quality={POST_IMAGE_QUALITY}
        loading="eager"
        className="max-h-[88vh] max-w-[92vw] object-contain"
        style={{ width: 'auto', height: 'auto' }}
      />
      {media.length > 1 ? (
        <button type="button" aria-label="Next photo" disabled={activeIndex >= media.length - 1} onClick={() => onNavigate(Math.min(media.length - 1, activeIndex + 1))} className="absolute right-3 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30 sm:right-6">
          <ChevronRight aria-hidden="true" className="size-6" />
        </button>
      ) : null}
      <span className="absolute bottom-4 rounded-full bg-black/40 px-3 py-1.5 text-sm font-semibold text-white">
        {activeIndex + 1} / {media.length}
      </span>
    </div>
  )
}

function PhotoGallery({ media, authorName, flush = false, loading = 'lazy', fetchPriority, postId, photoTags = [] }: {
  media: FeedMedia[]
  authorName: string
  flush?: boolean
  postId?: string
  photoTags?: FeedPhotoTag[]
} & PhotoLoading) {
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

  const lightbox = activeIndex == null ? null : (
    <PhotoLightbox
      media={media}
      activeIndex={activeIndex}
      authorName={authorName}
      postId={postId}
      photoTags={photoTags}
      onClose={() => setActiveIndex(null)}
      onNavigate={setActiveIndex}
    />
  )

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
      <>
        <button type="button" onClick={() => open(0)} className={`mt-4 block w-full overflow-hidden rounded-2xl border border-mist-200 bg-mist-50 text-left hover:border-ocean-300 hover:bg-mist-50 transition-colors ${flush ? `${FLUSH_CLASS} ${FLUSH_WIDTH_CLASS}` : ''}`}>
          {/* The intrinsic size is only a placeholder ratio: `h-auto w-full` follows the photo once loaded. */}
          <MediaImage
            src={item.signedUrl}
            alt={item.altText ?? `Image attached to ${authorName}'s post`}
            width={1280}
            height={960}
            sizes={POST_IMAGE_SIZES}
            quality={POST_IMAGE_QUALITY}
            loading={loading}
            fetchPriority={fetchPriority}
            className="block h-auto w-full object-contain"
          />
        </button>
        {/* The single photo opens in the same lightbox as galleries (it used to set the index and render nothing). */}
        {lightbox}
      </>
    )
  }

  return (
    <>
      <div className={`mt-4 grid ${gridClass} gap-0.5 overflow-hidden rounded-2xl border border-mist-100 bg-mist-100 ${media.length === 3 ? 'grid-rows-2' : ''} ${flush ? FLUSH_CLASS : ''}`}>
        {visible.map((item, index) => (
          <button
            key={item.storagePath}
            type="button"
            onClick={() => open(index)}
            aria-label={index === 3 && overflow > 0 ? `View all ${media.length} photos` : `Open photo ${index + 1} of ${media.length}`}
            className={`relative min-w-0 overflow-hidden bg-white transition hover:brightness-95 ${imageGridClass(media.length, index)}`}
          >
            <MediaImage
              src={item.signedUrl ?? ''}
              alt={item.altText ?? `Photo ${index + 1} attached to ${authorName}'s post`}
              fill
              sizes={GRID_IMAGE_SIZES}
              quality={POST_IMAGE_QUALITY}
              loading={index === 0 ? loading : 'lazy'}
              fetchPriority={index === 0 ? fetchPriority : undefined}
              className="object-cover"
            />
            {index === 3 && overflow > 0 ? (
              <span className="absolute inset-0 grid place-items-center bg-navy-950/55 text-3xl font-semibold text-white">+{overflow}</span>
            ) : null}
          </button>
        ))}
      </div>

      {lightbox}
    </>
  )
}

export function PostMedia({
  media,
  authorName,
  flush = false,
  loading = 'lazy',
  fetchPriority,
  postId,
  photoTags,
}: {
  media: FeedMedia | FeedMedia[]
  authorName: string
  /** Edge to edge on phones (Home feed and post page). */
  flush?: boolean
  /** Lets the lightbox remove the viewer's own photo tag (round 9B). */
  postId?: string
  /** Members tagged in the post's photos, matched to each photo by `media.id` (round 9B). */
  photoTags?: FeedPhotoTag[]
} & PhotoLoading) {
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
    return <PdfDocumentCarousel key={first.storagePath} media={first} flush={flush} />
  }

  if (isVideo) {
    return (
      <div className={`mt-4 overflow-hidden rounded-2xl border border-mist-100 bg-black ${flush ? FLUSH_CLASS : ''}`}>
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
  return images.length
    ? <PhotoGallery media={images} authorName={authorName} flush={flush} loading={loading} fetchPriority={fetchPriority} postId={postId} photoTags={photoTags} />
    : null
}
