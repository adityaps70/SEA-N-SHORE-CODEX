'use client'

import { Ban, Ellipsis, Flag, LoaderCircle, Trash2 } from 'lucide-react'
import { useCallback, useId, useRef, useState, useTransition, type KeyboardEvent } from 'react'
import { ActionMenu, ActionMenuItem } from '@/components/ui/action-menu'
import { ReportContentButton } from '@/features/moderation/components/report-content-button'
import { blockProfile } from '@/features/network/actions'
import { deleteConversationAction } from '../actions'
import { useModalLayer } from './use-modal-layer'

/** Public profile page of a conversation partner, or null when they have no handle yet. */
export function messagingProfileHref(slug: string | null | undefined) {
  const clean = slug?.trim()
  return clean ? `/people/${encodeURIComponent(clean)}` : null
}

export type DeletedConversationResult = {
  conversationId: string
  unreadCount: number | null
}

function DeleteConversationPanel({
  conversationId,
  otherName,
  onClose,
  onDeleted,
}: {
  conversationId: string
  otherName: string
  onClose: () => void
  onDeleted: (result: DeletedConversationResult) => void
}) {
  const titleId = useId()
  const descriptionId = useId()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const pendingRef = useRef(false)
  const requestClose = useCallback(() => {
    if (!pendingRef.current) onClose()
  }, [onClose])
  const dialogRef = useModalLayer<HTMLDivElement>({ onClose: requestClose })

  async function confirmDelete() {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setError('')
    try {
      const result = await deleteConversationAction(conversationId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      onDeleted({ conversationId: result.conversationId, unreadCount: result.unreadCount })
    } catch {
      setError('We could not delete this conversation. Check your connection and try again.')
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[195] flex items-end justify-center bg-navy-950/40 p-0 sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose()
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="w-full max-w-md rounded-t-3xl border border-mist-100 bg-white p-5 shadow-2xl outline-none sm:rounded-3xl"
      >
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-red-50 text-red-700 ring-1 ring-red-100">
            <Trash2 aria-hidden="true" className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-bold text-navy-950">Delete this conversation?</h2>
            <p id={descriptionId} className="mt-1 text-sm leading-6 text-muted">
              It will be removed for you only. <span className="font-semibold text-navy-900">{otherName}</span> can still see it.
            </p>
          </div>
        </div>

        {error ? (
          <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            data-autofocus
            onClick={requestClose}
            disabled={pending}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-950 transition hover:border-navy-900/20 hover:bg-mist-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirmDelete()}
            disabled={pending}
            aria-busy={pending}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-red-700 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-wait disabled:opacity-70"
          >
            {pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
            {pending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** In-page confirmation for "Delete conversation". Mount it; it is only rendered while `open`. */
export function DeleteConversationDialog({
  open,
  ...props
}: {
  open: boolean
  conversationId: string
  otherName: string
  onClose: () => void
  onDeleted: (result: DeletedConversationResult) => void
}) {
  if (!open) return null
  return <DeleteConversationPanel {...props} />
}

const DEFAULT_TRIGGER_CLASS = 'grid size-9 shrink-0 cursor-pointer place-items-center rounded-xl border border-mist-100 bg-white text-navy-900 shadow-sm transition hover:border-ocean-200 hover:bg-ocean-50 hover:text-ocean-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-600 aria-expanded:bg-ocean-50 aria-expanded:text-ocean-800'

const menuItemClass = 'min-h-10 gap-2.5'

/**
 * ⋯ menu for a conversation (thread header, inbox row, compact dock chat).
 * "Delete conversation" asks for confirmation in the page before deleting the
 * conversation for the viewer only. With `safety` (the phone chat page bar) it
 * also offers Report (the shared profile report dialog) and Block. On phones the
 * menu is a bottom sheet; on desktop it stays a dropdown.
 */
export function ConversationActionsMenu({
  conversationId,
  otherName,
  onDeleted,
  triggerClassName = DEFAULT_TRIGGER_CLASS,
  align = 'right',
  direction = 'down',
  className = 'relative',
  safety,
}: {
  conversationId: string
  otherName: string
  onDeleted: (result: DeletedConversationResult) => void
  triggerClassName?: string
  align?: 'left' | 'right'
  /** Open below the trigger (default) or above it, e.g. for the last inbox rows. */
  direction?: 'down' | 'up'
  className?: string
  /** Report and Block the other participant; `onBlocked` runs after a successful block. */
  safety?: { otherProfileId: string; onBlocked?: () => void }
}) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [blockError, setBlockError] = useState('')
  const [blocking, startBlock] = useTransition()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuId = useId()
  const close = useCallback(() => setOpen(false), [])
  const closeConfirm = useCallback(() => setConfirming(false), [])

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
    }
  }

  function startDelete() {
    // Focus the trigger first so the dialog returns focus to it when it closes.
    triggerRef.current?.focus({ preventScroll: true })
    setOpen(false)
    setConfirming(true)
  }

  function startReport() {
    triggerRef.current?.focus({ preventScroll: true })
    setOpen(false)
    setReporting(true)
  }

  function block() {
    if (!safety) return
    setOpen(false)
    setBlockError('')
    startBlock(async () => {
      const result = await blockProfile(safety.otherProfileId)
      if (!result.ok) {
        setBlockError(result.error)
        return
      }
      safety.onBlocked?.()
    })
  }

  return (
    <div className={className}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Conversation options for ${otherName}`}
        title="Conversation options"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
        className={triggerClassName}
      >
        <Ellipsis aria-hidden="true" className="size-4" />
      </button>
      <ActionMenu
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        id={menuId}
        label={`Conversation options for ${otherName}`}
        align={align === 'right' ? 'end' : 'start'}
        side={direction === 'up' ? 'top' : 'bottom'}
        className="w-56 shadow-[var(--shadow-card)]"
      >
        {safety ? (
          <>
            <ActionMenuItem tone="danger" onClick={startReport} className={menuItemClass} icon={<Flag aria-hidden="true" className="size-4" />}>
              Report
            </ActionMenuItem>
            <ActionMenuItem tone="danger" onClick={block} disabled={blocking} className={menuItemClass} icon={<Ban aria-hidden="true" className="size-4" />}>
              Block
            </ActionMenuItem>
          </>
        ) : null}
        <ActionMenuItem tone="danger" onClick={startDelete} className={menuItemClass} icon={<Trash2 aria-hidden="true" className="size-4" />}>
          Delete conversation
        </ActionMenuItem>
      </ActionMenu>
      {blockError ? (
        <p role="alert" className="absolute right-0 top-full z-50 mt-1 w-64 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700 shadow-sm">
          {blockError}
        </p>
      ) : null}
      {reporting && safety ? (
        <ReportContentButton
          targetType="profile"
          targetId={safety.otherProfileId}
          label={`Report ${otherName}`}
          hideTrigger
          defaultOpen
          onClose={() => setReporting(false)}
        />
      ) : null}
      <DeleteConversationDialog
        open={confirming}
        conversationId={conversationId}
        otherName={otherName}
        onClose={closeConfirm}
        onDeleted={(result) => {
          setConfirming(false)
          onDeleted(result)
        }}
      />
    </div>
  )
}
