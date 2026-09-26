'use client'

import {
  ChevronLeft,
  ChevronRight,
  Download,
  ImageOff,
  Maximize2,
  X,
  ZoomIn,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type TouchEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { useModalLayer } from './use-modal-layer'

export type LightboxImage = {
  /** Stable id (the message id) so the viewer survives thread re-renders. */
  id: string
  src: string
  alt: string
  name: string
  /** Authorised same-origin download URL. Omitted for photos that are still sending. */
  downloadUrl?: string | null
}

type ImageLightboxProps = {
  images: LightboxImage[]
  activeId: string | null
  onActiveIdChange: (id: string) => void
  onClose: () => void
}

const subscribeNothing = () => () => {}

function useIsClient() {
  return useSyncExternalStore(subscribeNothing, () => true, () => false)
}

/**
 * In-app photo viewer shared by the messages page and the chat dock. It is
 * rendered in a portal so opening or closing it never remounts or scrolls the
 * conversation underneath.
 */
export function ImageLightbox({ images, activeId, onActiveIdChange, onClose }: ImageLightboxProps) {
  const isClient = useIsClient()
  const index = activeId ? images.findIndex((image) => image.id === activeId) : -1
  if (!isClient || index < 0) return null

  return createPortal(
    <LightboxDialog
      images={images}
      index={index}
      onActiveIdChange={onActiveIdChange}
      onClose={onClose}
    />,
    document.body,
  )
}

function LightboxDialog({
  images,
  index,
  onActiveIdChange,
  onClose,
}: {
  images: LightboxImage[]
  index: number
  onActiveIdChange: (id: string) => void
  onClose: () => void
}) {
  const image = images[index]!
  const titleId = useId()
  const dialogRef = useModalLayer<HTMLDivElement>({ onClose })
  const stageRef = useRef<HTMLDivElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const pointerStartedOnBackdrop = useRef(false)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const [zoom, setZoom] = useState<{ imageId: string; width: number } | null>(null)
  const [failedImageId, setFailedImageId] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  const zoomedWidth = zoom?.imageId === image.id ? zoom.width : null
  const zoomed = zoomedWidth !== null
  const failed = failedImageId === image.id
  const hasPrevious = index > 0
  const hasNext = index < images.length - 1
  const src = retryCount > 0 && image.src.startsWith('/')
    ? `${image.src}${image.src.includes('?') ? '&' : '?'}retry=${retryCount}`
    : image.src

  const goTo = useCallback((nextIndex: number) => {
    const next = images[nextIndex]
    if (!next) return
    setZoom(null)
    setRetryCount(0)
    onActiveIdChange(next.id)
  }, [images, onActiveIdChange])

  function toggleZoom() {
    if (zoomed) {
      setZoom(null)
      return
    }
    const element = imageRef.current
    const stage = stageRef.current
    const rendered = element?.getBoundingClientRect().width || element?.width || 0
    const natural = element?.naturalWidth || 0
    const stageWidth = stage?.clientWidth || rendered
    const target = Math.round(Math.min(
      Math.max(natural, rendered * 2, stageWidth * 1.25),
      Math.max(rendered * 4, stageWidth * 1.25),
    ))
    setZoom({ imageId: image.id, width: target || 1600 })
  }

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage || !zoomed) return
    stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2)
    stage.scrollTop = Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2)
  }, [zoomed, zoomedWidth])

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key === 'ArrowLeft' && hasPrevious) {
        event.preventDefault()
        goTo(index - 1)
      } else if (event.key === 'ArrowRight' && hasNext) {
        event.preventDefault()
        goTo(index + 1)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [goTo, hasNext, hasPrevious, index])

  useEffect(() => {
    // The previous/next button disappears at either end; keep focus in the viewer.
    const dialog = dialogRef.current
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true })
  }, [dialogRef, index])

  function onStageMouseDown(event: MouseEvent<HTMLDivElement>) {
    pointerStartedOnBackdrop.current = event.target === event.currentTarget
      || (event.target as HTMLElement).dataset.lightboxBackdrop === 'true'
  }

  function onStageClick(event: MouseEvent<HTMLDivElement>) {
    const onBackdrop = event.target === event.currentTarget
      || (event.target as HTMLElement).dataset.lightboxBackdrop === 'true'
    if (onBackdrop && pointerStartedOnBackdrop.current) onClose()
    pointerStartedOnBackdrop.current = false
  }

  function onTouchStart(event: TouchEvent<HTMLDivElement>) {
    if (zoomed || event.touches.length !== 1) {
      touchStart.current = null
      return
    }
    const touch = event.touches[0]!
    touchStart.current = { x: touch.clientX, y: touch.clientY }
  }

  function onTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const start = touchStart.current
    touchStart.current = null
    const touch = event.changedTouches[0]
    if (!start || !touch || zoomed) return
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    if (dx > 0 && hasPrevious) goTo(index - 1)
    if (dx < 0 && hasNext) goTo(index + 1)
  }

  const counter = images.length > 1 ? `${index + 1} of ${images.length}` : null

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid="image-lightbox"
      className="fixed inset-x-0 top-0 z-[200] flex h-[100dvh] flex-col overflow-hidden bg-navy-950 text-white outline-none"
    >
      <div className="flex min-h-14 shrink-0 items-center gap-2 px-3 py-2 sm:px-5">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="truncate text-sm font-semibold">
            <span className="sr-only">Photo viewer: </span>{image.name}
          </h2>
          {counter ? <p className="text-xs text-white/70">{counter}</p> : null}
        </div>
        <button
          type="button"
          onClick={toggleZoom}
          disabled={failed}
          aria-pressed={zoomed}
          aria-label={zoomed ? 'Fit photo to screen' : 'Zoom in'}
          title={zoomed ? 'Fit to screen' : 'Zoom in'}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-white/10 transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-40"
        >
          {zoomed ? <Maximize2 aria-hidden="true" className="size-5" /> : <ZoomIn aria-hidden="true" className="size-5" />}
        </button>
        {image.downloadUrl && !failed ? (
          <a
            href={image.downloadUrl}
            download={image.name}
            aria-label={`Download ${image.name}`}
            title="Download"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-white/10 transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <Download aria-hidden="true" className="size-5" />
          </a>
        ) : null}
        <button
          data-autofocus
          type="button"
          onClick={onClose}
          aria-label="Close photo viewer"
          title="Close (Esc)"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-white/10 transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={stageRef}
          data-testid="image-lightbox-backdrop"
          onMouseDown={onStageMouseDown}
          onClick={onStageClick}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          className={`absolute inset-0 overscroll-contain ${
            zoomed ? 'overflow-auto touch-pan-x touch-pan-y touch-pinch-zoom' : 'overflow-hidden touch-pinch-zoom'
          }`}
        >
          <div
            data-lightbox-backdrop="true"
            className={`flex min-h-full items-center justify-center p-3 sm:p-6 ${zoomed ? 'w-max min-w-full' : 'w-full'}`}
          >
            {failed ? (
              <div role="alert" className="max-w-sm rounded-2xl bg-white/10 p-5 text-center">
                <ImageOff aria-hidden="true" className="mx-auto size-8 text-white/80" />
                <p className="mt-3 text-sm font-semibold">This photo could not be loaded.</p>
                <p className="mt-1 text-xs leading-5 text-white/75">It may have been removed, or your connection dropped. Try again, or close the viewer and refresh the conversation.</p>
                <button
                  type="button"
                  onClick={() => {
                    setFailedImageId(null)
                    setRetryCount((count) => count + 1)
                  }}
                  className="mt-4 inline-flex min-h-10 items-center rounded-xl bg-white px-4 text-sm font-semibold text-navy-950 hover:bg-mist-50"
                >
                  Try again
                </button>
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- authorised same-origin attachment route
              <img
                ref={imageRef}
                key={`${image.id}:${retryCount}`}
                src={src}
                alt={image.alt}
                draggable={false}
                onClick={toggleZoom}
                onError={() => setFailedImageId(image.id)}
                style={zoomedWidth ? { width: `${zoomedWidth}px` } : undefined}
                className={zoomed
                  ? 'h-auto max-w-none cursor-zoom-out select-none'
                  : 'h-auto max-h-[calc(100dvh-7rem)] w-auto max-w-full cursor-zoom-in select-none object-contain'}
              />
            )}
          </div>
        </div>

        {hasPrevious ? (
          <button
            type="button"
            onClick={() => goTo(index - 1)}
            aria-label="Previous photo"
            className="absolute left-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-navy-950/60 text-white ring-1 ring-white/20 transition hover:bg-navy-950/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:left-5"
          >
            <ChevronLeft aria-hidden="true" className="size-6" />
          </button>
        ) : null}
        {hasNext ? (
          <button
            type="button"
            onClick={() => goTo(index + 1)}
            aria-label="Next photo"
            className="absolute right-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-navy-950/60 text-white ring-1 ring-white/20 transition hover:bg-navy-950/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:right-5"
          >
            <ChevronRight aria-hidden="true" className="size-6" />
          </button>
        ) : null}
      </div>
    </div>
  )
}
