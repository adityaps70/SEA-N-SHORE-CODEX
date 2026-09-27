'use client'

import { ChartBar, Copy, FileText, Play, Repeat2, X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { PostCard } from '@/features/feed/components/post-card'
import type { FeedPost } from '@/features/feed/types'
import { savedPostLabel, savedPostPreview, type SavedPostPreview } from './saved-post-preview'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function CornerBadges({ preview, onMedia }: { preview: SavedPostPreview; onMedia: boolean }) {
  const tone = onMedia ? 'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]' : 'text-navy-700'
  const icons = [
    preview.kind === 'video' ? <Play key="video" aria-hidden="true" className="size-4 fill-current" /> : null,
    preview.mediaCount > 1 ? <Copy key="multiple" aria-hidden="true" className="size-4" /> : null,
    preview.kind === 'document' ? <FileText key="document" aria-hidden="true" className="size-4" /> : null,
    preview.hasPoll ? <ChartBar key="poll" aria-hidden="true" className="size-4" /> : null,
    preview.isRepost ? <Repeat2 key="repost" aria-hidden="true" className="size-4" /> : null,
  ].filter(Boolean)
  if (!icons.length) return null
  return <span data-testid="tile-badges" className={`pointer-events-none absolute right-1.5 top-1.5 flex items-center gap-1 ${tone}`}>{icons}</span>
}

function TileFace({ preview }: { preview: SavedPostPreview }) {
  if (preview.kind === 'image' && preview.mediaUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={preview.mediaUrl} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
  }
  if (preview.kind === 'video' && preview.mediaUrl) {
    // #t=0.1 asks the browser to paint the first frame as the still image.
    return <video src={`${preview.mediaUrl}#t=0.1`} muted playsInline preload="metadata" tabIndex={-1} aria-hidden="true" className="pointer-events-none absolute inset-0 size-full bg-navy-950 object-cover" />
  }
  if (preview.kind === 'document') {
    return (
      <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-navy-50 to-mist-100 p-2 text-center text-navy-900">
        <FileText aria-hidden="true" className="size-7 text-ocean-700 sm:size-9" />
        <span className="line-clamp-2 break-words text-[11px] font-semibold leading-4 sm:text-sm sm:leading-5">{preview.documentName}</span>
      </span>
    )
  }
  return (
    <span className="absolute inset-0 bg-gradient-to-br from-ocean-50 to-mist-100 p-2.5 pr-6 text-left sm:p-4 sm:pr-8">
      <span className="line-clamp-5 break-words text-[11px] font-medium leading-4 text-navy-900 sm:line-clamp-6 sm:text-sm sm:leading-5">
        {preview.text || (preview.hasPoll ? 'Poll' : 'Post')}
      </span>
    </span>
  )
}

function SavedPostDialog({ post, onClose }: { post: FeedPost; onClose(): void }) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const panel = panelRef.current
    panel?.querySelector<HTMLElement>('[data-dialog-close]')?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Something opened from inside the post (photo viewer, share or report dialog) owns the keyboard first.
    const nestedLayerOpen = () => Boolean(panelRef.current?.querySelector('[aria-modal="true"]'))

    // Listen on window so the post's own menus and dialogs, which listen on the document, handle Escape first.
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (event.defaultPrevented || nestedLayerOpen()) return
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current || nestedLayerOpen()) return
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!panelRef.current.contains(document.activeElement)) {
        event.preventDefault()
        first?.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-navy-950/55 backdrop-blur-[2px] sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[1.5rem] border border-mist-100 bg-mist-50 shadow-2xl sm:max-w-2xl sm:rounded-[1.5rem]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-mist-100 bg-white px-4 py-3 sm:px-5">
          <h2 id={titleId} className="min-w-0 truncate text-base font-bold text-navy-950">Saved post by {post.author.fullName}</h2>
          <button
            type="button"
            data-dialog-close
            aria-label="Close saved post"
            onClick={onClose}
            className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-xl border border-mist-200 text-navy-700 transition hover:bg-mist-50 hover:text-navy-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500/40"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-4">
          <PostCard post={post} />
        </div>
      </div>
    </div>
  )
}

export function SavedPostsGrid({ posts }: { posts: FeedPost[] }) {
  // Keep the opened post itself (not just its id) so the dialog stays open after Unsave
  // refreshes the page and the tile drops out of the grid; the member can still save it again.
  const [openPost, setOpenPost] = useState<FeedPost | null>(null)
  const openerIndexRef = useRef<number | null>(null)
  const gridRef = useRef<HTMLUListElement | null>(null)

  const close = useCallback(() => {
    setOpenPost(null)
    const index = openerIndexRef.current
    openerIndexRef.current = null
    window.requestAnimationFrame(() => {
      const tiles = gridRef.current?.querySelectorAll<HTMLElement>('[data-saved-tile]')
      if (!tiles?.length || index == null) return
      tiles[Math.min(index, tiles.length - 1)]?.focus()
    })
  }, [])

  return (
    <>
      <ul ref={gridRef} aria-label="Saved posts" className="grid grid-cols-3 gap-0.5 sm:gap-1">
        {posts.map((post, index) => {
          const preview = savedPostPreview(post)
          const onMedia = preview.kind === 'image' || preview.kind === 'video'
          return (
            <li key={post.id} className="min-w-0">
              <button
                type="button"
                data-saved-tile
                aria-haspopup="dialog"
                aria-label={savedPostLabel(preview)}
                onClick={() => {
                  openerIndexRef.current = index
                  setOpenPost(post)
                }}
                className="group relative block aspect-square w-full cursor-pointer overflow-hidden bg-mist-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ocean-600"
              >
                <TileFace preview={preview} />
                <span aria-hidden="true" className="absolute inset-0 bg-navy-950/0 transition group-hover:bg-navy-950/15" />
                <CornerBadges preview={preview} onMedia={onMedia} />
              </button>
            </li>
          )
        })}
      </ul>
      {openPost ? <SavedPostDialog post={openPost} onClose={close} /> : null}
    </>
  )
}
