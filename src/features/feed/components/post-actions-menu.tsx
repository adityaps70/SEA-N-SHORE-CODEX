'use client'

import { Bookmark, EyeOff, Flag, Link2, MoreHorizontal, PencilLine, ShieldMinus, Trash2, UserMinus } from 'lucide-react'
import { useCallback, useRef, useState, type RefObject } from 'react'
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from '@/components/ui/action-menu'

const itemClass = 'rounded-xl py-2.5'

/**
 * The post header "⋯" menu (a bottom sheet on phones, a dropdown from md). Secondary actions live here so the action row stays
 * Like · Comment · Repost · Send. Whoever may change the post (its author, or an admin of the
 * organization it was posted as) gets Edit and Delete; other members get Hide, Unfollow (only
 * while following the author) and Report.
 */
export function PostActionsMenu({
  authorName,
  isOwner,
  canEdit = isOwner,
  canDelete = isOwner,
  saved,
  canUnfollow,
  pending,
  onToggleSave,
  onCopyLink,
  onHide,
  onUnfollow,
  onReport,
  onDelete,
  onEdit,
  canModerateGroup = false,
  onRemoveFromGroup,
  triggerRef: externalTriggerRef,
}: {
  authorName: string
  isOwner: boolean
  /** Defaults to isOwner. */
  canEdit?: boolean
  /** Defaults to isOwner. */
  canDelete?: boolean
  /** The viewer administers the community group this post is in (round 9B). */
  canModerateGroup?: boolean
  /** "Remove from group", shown to group admins who cannot otherwise delete the post. */
  onRemoveFromGroup?(): void
  saved: boolean
  canUnfollow: boolean
  pending: boolean
  onToggleSave(): void
  onCopyLink(): void
  onHide(): void
  onUnfollow(): void
  onReport(): void
  onDelete(): void
  onEdit?(): void
  /** Receives the trigger element so dialogs opened from the menu can return focus to it. */
  triggerRef?: RefObject<HTMLButtonElement | null>
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const internalTriggerRef = useRef<HTMLButtonElement | null>(null)
  const menuTriggerRef = externalTriggerRef ?? internalTriggerRef
  const closeMenu = useCallback(() => setMenuOpen(false), [])

  function run(action: () => void) {
    return () => {
      closeMenu()
      action()
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={menuTriggerRef}
        type="button"
        aria-label="Post options"
        title="More options"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((value) => !value)}
        className="inline-flex size-9 max-md:size-11 cursor-pointer items-center justify-center rounded-full border border-transparent text-muted transition hover:border-mist-100 hover:bg-mist-50 hover:text-navy-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500/40"
      >
        <MoreHorizontal aria-hidden="true" className="size-5" />
      </button>
      <ActionMenu open={menuOpen} onClose={closeMenu} anchorRef={menuTriggerRef} label={`Options for ${authorName}'s post`} className="w-[min(18rem,calc(100vw-2rem))] rounded-2xl">
        <ActionMenuItem disabled={pending} onClick={run(onToggleSave)} className={itemClass} icon={<Bookmark aria-hidden="true" className="size-4" fill={saved ? 'currentColor' : 'none'} />}>
          {saved ? 'Remove from saved' : 'Save post'}
        </ActionMenuItem>
        <ActionMenuItem onClick={run(onCopyLink)} className={itemClass} icon={<Link2 aria-hidden="true" className="size-4" />}>
          Copy link
        </ActionMenuItem>
        {canEdit && onEdit ? (
          <ActionMenuItem disabled={pending} onClick={run(onEdit)} className={itemClass} icon={<PencilLine aria-hidden="true" className="size-4" />}>
            Edit post
          </ActionMenuItem>
        ) : null}
        {canDelete ? (
          <>
            <ActionMenuSeparator />
            <ActionMenuItem tone="danger" disabled={pending} onClick={run(onDelete)} className={itemClass} icon={<Trash2 aria-hidden="true" className="size-4" />}>
              Delete post
            </ActionMenuItem>
          </>
        ) : null}
        {canModerateGroup && !canDelete && onRemoveFromGroup ? (
          <>
            <ActionMenuSeparator />
            <ActionMenuItem tone="danger" disabled={pending} onClick={run(onRemoveFromGroup)} className={itemClass} icon={<ShieldMinus aria-hidden="true" className="size-4" />}>
              Remove from group
            </ActionMenuItem>
          </>
        ) : null}
        {isOwner || canDelete ? null : (
          <>
            <ActionMenuItem disabled={pending} onClick={run(onHide)} className={itemClass} icon={<EyeOff aria-hidden="true" className="size-4" />}>
              Hide post
            </ActionMenuItem>
            {canUnfollow ? (
              <ActionMenuItem disabled={pending} onClick={run(onUnfollow)} className={itemClass} icon={<UserMinus aria-hidden="true" className="size-4" />}>
                <span className="min-w-0 break-words">Unfollow {authorName}</span>
              </ActionMenuItem>
            ) : null}
            <ActionMenuSeparator />
            <ActionMenuItem tone="danger" onClick={run(onReport)} className={itemClass} icon={<Flag aria-hidden="true" className="size-4" />}>
              Report post
            </ActionMenuItem>
          </>
        )}
      </ActionMenu>
    </div>
  )
}
