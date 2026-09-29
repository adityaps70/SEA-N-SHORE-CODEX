'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useId, useRef, useState, useTransition } from 'react'
import { MoreHorizontal, ShieldCheck, ShieldOff, UserMinus } from 'lucide-react'
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from '@/components/ui/action-menu'
import { removeMember, setMemberRole } from '../actions'
import type { GroupRole } from '../types'

/** Group admins: Make admin / Remove admin / Remove from group for one member row. */
export function MemberActionsMenu({ groupId, profileId, fullName, role }: { groupId: string; profileId: string; fullName: string; role: GroupRole }) {
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
      <ActionMenu open={open} onClose={close} anchorRef={triggerRef} id={menuId} label={`Actions for ${fullName}`} align="end" className="w-56 shadow-[var(--shadow-card)]">
        {role === 'admin' ? (
          <ActionMenuItem onClick={() => run(() => setMemberRole({ groupId, profileId, role: 'member' }))} icon={<ShieldOff aria-hidden="true" className="size-4 text-muted" />}>Remove admin</ActionMenuItem>
        ) : (
          <ActionMenuItem onClick={() => run(() => setMemberRole({ groupId, profileId, role: 'admin' }))} icon={<ShieldCheck aria-hidden="true" className="size-4 text-muted" />}>Make admin</ActionMenuItem>
        )}
        <ActionMenuSeparator />
        <ActionMenuItem
          tone="danger"
          onClick={() => {
            if (typeof window !== 'undefined' && !window.confirm(`Remove ${fullName} from the group? They will not be able to rejoin on their own.`)) {
              close()
              return
            }
            run(() => removeMember({ groupId, profileId }))
          }}
          icon={<UserMinus aria-hidden="true" className="size-4" />}
        >
          Remove from group
        </ActionMenuItem>
      </ActionMenu>
      {error ? <p role="alert" className="absolute right-0 top-full z-40 mt-1 w-64 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 shadow-sm">{error}</p> : null}
    </div>
  )
}
