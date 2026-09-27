'use client'

import { Bookmark, EyeOff, Flag, Link2, MoreHorizontal, Trash2, UserMinus } from 'lucide-react'
import type { RefObject } from 'react'
import { useFeedMenu } from './use-feed-menu'

const itemClass = 'flex w-full items-center gap-3 [&>svg]:shrink-0 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-navy-950 hover:bg-mist-50 focus-visible:bg-mist-50 focus-visible:outline-none disabled:opacity-50'

/**
 * The post header "⋯" menu. Secondary actions live here so the action row stays
 * Like · Comment · Repost/Share · Send. Owners get Delete; other members get Hide,
 * Unfollow (only while following the author) and Report.
 */
export function PostActionsMenu({
  authorName,
  isOwner,
  saved,
  canUnfollow,
  pending,
  onToggleSave,
  onCopyLink,
  onHide,
  onUnfollow,
  onReport,
  onDelete,
  triggerRef: externalTriggerRef,
}: {
  authorName: string
  isOwner: boolean
  saved: boolean
  canUnfollow: boolean
  pending: boolean
  onToggleSave(): void
  onCopyLink(): void
  onHide(): void
  onUnfollow(): void
  onReport(): void
  onDelete(): void
  /** Receives the trigger element so dialogs opened from the menu can return focus to it. */
  triggerRef?: RefObject<HTMLButtonElement | null>
}) {
  const { open: menuOpen, toggle: toggleMenu, close: closeMenu, rootRef: menuRootRef, triggerRef: menuTriggerRef, menuRef, onMenuKeyDown } = useFeedMenu(externalTriggerRef)

  function run(action: () => void) {
    return () => {
      closeMenu()
      action()
    }
  }

  return (
    <div ref={menuRootRef} className="relative shrink-0">
      <button
        ref={menuTriggerRef}
        type="button"
        aria-label="Post options"
        title="More options"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={toggleMenu}
        className="inline-flex size-9 items-center justify-center rounded-full text-muted transition hover:bg-mist-50 hover:text-navy-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500/40"
      >
        <MoreHorizontal aria-hidden="true" className="size-5" />
      </button>
      {menuOpen ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Options for ${authorName}'s post`}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-50 mt-1 w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-mist-100 bg-white p-1.5 shadow-xl"
        >
          <button type="button" role="menuitem" disabled={pending} onClick={run(onToggleSave)} className={itemClass}>
            <Bookmark aria-hidden="true" className="size-4" fill={saved ? 'currentColor' : 'none'} />
            {saved ? 'Remove from saved' : 'Save post'}
          </button>
          <button type="button" role="menuitem" onClick={run(onCopyLink)} className={itemClass}>
            <Link2 aria-hidden="true" className="size-4" />
            Copy link
          </button>
          {isOwner ? (
            <>
              <div role="separator" className="my-1 h-px bg-mist-100" />
              <button type="button" role="menuitem" disabled={pending} onClick={run(onDelete)} className={`${itemClass} text-red-700 hover:bg-red-50 focus-visible:bg-red-50`}>
                <Trash2 aria-hidden="true" className="size-4" />
                Delete post
              </button>
            </>
          ) : (
            <>
              <button type="button" role="menuitem" disabled={pending} onClick={run(onHide)} className={itemClass}>
                <EyeOff aria-hidden="true" className="size-4" />
                Hide post
              </button>
              {canUnfollow ? (
                <button type="button" role="menuitem" disabled={pending} onClick={run(onUnfollow)} className={itemClass}>
                  <UserMinus aria-hidden="true" className="size-4" />
                  <span className="min-w-0 break-words">Unfollow {authorName}</span>
                </button>
              ) : null}
              <div role="separator" className="my-1 h-px bg-mist-100" />
              <button type="button" role="menuitem" onClick={run(onReport)} className={`${itemClass} text-red-700 hover:bg-red-50 focus-visible:bg-red-50`}>
                <Flag aria-hidden="true" className="size-4" />
                Report post
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
