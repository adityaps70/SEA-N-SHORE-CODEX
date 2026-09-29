'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useId, useRef, useState, useTransition } from 'react'
import { Crown, MoreHorizontal, ShieldCheck, ShieldOff, UserMinus } from 'lucide-react'
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from '@/components/ui/action-menu'
import { removeMember, setMemberRole, transferOwnership } from '../actions'
import type { GroupRole } from '../types'

/**
 * Moderator actions for one member row: Make moderator / Remove moderator / Remove from group,
 * plus Transfer ownership for the owner (round 9C).
 */
export function MemberActionsMenu({
  groupId,
  profileId,
  fullName,
  role,
  canTransferOwnership = false,
}: {
  groupId: string
  profileId: string
  fullName: string
  role: GroupRole
  /** Only the group owner may hand the group over. */
  canTransferOwnership?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuId = useId()
  const close = useCallback(() => setOpen(false), [])

  function run(work: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    close()
    setError('')
    startTransition(async () => {
      const result = await work().catch(() => null)
      if (!result || !result.ok) {
        setError(result?.error ?? 'We could not update this member. Check your connection and try again.')
        return
      }
      router.refresh()
    })
  }

  function confirmThen(question: string, work: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    if (typeof window !== 'undefined' && !window.confirm(question)) {
      close()
      return
    }
    run(work)
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Actions for ${fullName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={pending}
        onClick={() => setOpen((value) => !value)}
        className="grid size-10 cursor-pointer place-items-center rounded-full text-muted transition hover:bg-mist-50 hover:text-navy-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 disabled:opacity-60 max-md:size-11"
      >
        <MoreHorizontal aria-hidden="true" className="size-5" />
      </button>
      <ActionMenu open={open} onClose={close} anchorRef={triggerRef} id={menuId} label={`Actions for ${fullName}`} align="end" className="w-60 shadow-[var(--shadow-card)]">
        {role === 'admin' ? (
          <ActionMenuItem onClick={() => run(() => setMemberRole({ groupId, profileId, role: 'member' }))} icon={<ShieldOff aria-hidden="true" className="size-4 text-muted" />}>Remove moderator</ActionMenuItem>
        ) : (
          <ActionMenuItem onClick={() => run(() => setMemberRole({ groupId, profileId, role: 'admin' }))} icon={<ShieldCheck aria-hidden="true" className="size-4 text-muted" />}>Make moderator</ActionMenuItem>
        )}
        {canTransferOwnership ? (
          <ActionMenuItem
            onClick={() => confirmThen(`Make ${fullName} the owner of this group? You will stay on as a moderator. This cannot be undone by you.`, () => transferOwnership({ groupId, profileId }))}
            icon={<Crown aria-hidden="true" className="size-4 text-muted" />}
          >
            Transfer ownership
          </ActionMenuItem>
        ) : null}
        <ActionMenuSeparator />
        <ActionMenuItem
          tone="danger"
          onClick={() => confirmThen(`Remove ${fullName} from the group? They will not be able to rejoin on their own.`, () => removeMember({ groupId, profileId }))}
          icon={<UserMinus aria-hidden="true" className="size-4" />}
        >
          Remove from group
        </ActionMenuItem>
      </ActionMenu>
      {error ? <p role="alert" className="absolute right-0 top-full z-40 mt-1 w-64 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 shadow-sm">{error}</p> : null}
    </div>
  )
}
