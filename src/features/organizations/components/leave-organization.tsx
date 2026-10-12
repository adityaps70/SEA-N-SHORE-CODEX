'use client'

import { useCallback, useEffect, useId, useRef, useState, useTransition, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { LogOut, MoreHorizontal } from 'lucide-react'
import { ActionMenu, ActionMenuItem } from '@/components/ui/action-menu'
import { FeedDialog } from '@/features/feed/components/feed-dialog'
import { accessRoleLabel } from '../access-request-labels'
import { getLeaveOrganizationState, leaveOrganization, transferOrganizationOwnership } from '../membership-actions'
import type { LeaveOrganizationState } from '../membership-repository'

/** The organization page's "…" menu asks the page's leave dialog to open (round F). */
export const ORGANIZATION_LEAVE_OPEN_EVENT = 'sns:organization-leave-open'

const dangerButton = 'inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-60'
const primaryButton = 'inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-navy-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButton = 'inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-950 hover:bg-mist-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 disabled:cursor-not-allowed disabled:opacity-60'

/**
 * Round F (F2): leaving an organization, for any approved member. Explains what changes, then
 * leaves. The organization's only owner is asked to hand it to an administrator first.
 */
export function LeaveOrganizationDialog({
  companyId,
  organizationName,
  onClose,
  returnFocusRef,
}: {
  companyId: string
  organizationName: string
  onClose(): void
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  const router = useRouter()
  const pickerId = useId()
  const [state, setState] = useState<LeaveOrganizationState | null>(null)
  const [error, setError] = useState('')
  const [newOwnerId, setNewOwnerId] = useState('')
  const [pending, startTransition] = useTransition()

  const load = useCallback(async () => {
    const result = await getLeaveOrganizationState({ companyId })
    if (result.ok) {
      setState(result.state)
      setNewOwnerId(result.state.administrators[0]?.profileId ?? '')
    } else {
      setError(result.error)
    }
  }, [companyId])

  useEffect(() => {
    let active = true
    void getLeaveOrganizationState({ companyId }).then((result) => {
      if (!active) return
      if (result.ok) {
        setState(result.state)
        setNewOwnerId(result.state.administrators[0]?.profileId ?? '')
      } else {
        setError(result.error)
      }
    })
    return () => { active = false }
  }, [companyId])

  function leave() {
    setError('')
    startTransition(async () => {
      const result = await leaveOrganization({ companyId })
      if (!result.ok) {
        setError(result.error)
        if (result.code === 'last_owner') await load()
        return
      }
      onClose()
      router.push('/organizations')
    })
  }

  function transfer() {
    if (!newOwnerId) return
    setError('')
    startTransition(async () => {
      const result = await transferOrganizationOwnership({ companyId, newOwnerId })
      if (!result.ok) {
        setError(result.error)
        return
      }
      await load()
    })
  }

  const role = state ? accessRoleLabel(state.role) : null

  const dialog = state?.lastOwner ? (
    <FeedDialog
      role="alertdialog"
      title="Transfer ownership first"
      description={`You are the only owner of ${organizationName}. Hand it to an administrator before you leave; you stay on as an administrator until you leave.`}
      onClose={() => { if (!pending) onClose() }}
      closeLabel="Close without leaving"
      returnFocusRef={returnFocusRef}
    >
      {state.administrators.length ? (
        <div>
          <label htmlFor={pickerId} className="block text-sm font-semibold text-navy-950">New owner</label>
          <select
            id={pickerId}
            value={newOwnerId}
            onChange={(event) => setNewOwnerId(event.target.value)}
            disabled={pending}
            className="mt-1.5 min-h-11 w-full cursor-pointer rounded-xl border border-mist-200 bg-white px-3 text-sm text-navy-950 focus:border-ocean-500"
          >
            {state.administrators.map((admin) => <option key={admin.profileId} value={admin.profileId}>{admin.fullName}</option>)}
          </select>
          <p className="mt-1 text-xs text-muted">Only current administrators of {organizationName} can become its owner.</p>
        </div>
      ) : (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
          {organizationName} has no administrator yet. Give a colleague the Administrator role first (Manage page › Team &amp; roles, or approve their request for that role), then come back to transfer ownership.
        </p>
      )}
      {error ? <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} disabled={pending} className={secondaryButton}>Cancel</button>
        {state.administrators.length ? (
          <button type="button" onClick={transfer} disabled={pending || !newOwnerId} className={primaryButton}>
            {pending ? 'Transferring…' : 'Transfer ownership'}
          </button>
        ) : null}
      </div>
    </FeedDialog>
  ) : (
    <FeedDialog
      role="alertdialog"
      title={`Leave ${organizationName}?`}
      description={state ? `You are ${/^[AEIOU]/i.test(role ?? '') ? 'an' : 'a'} ${role} here.` : error ? undefined : 'Checking your membership…'}
      onClose={() => { if (!pending) onClose() }}
      closeLabel="Stay in the organization"
      returnFocusRef={returnFocusRef}
      initialFocusSelector="[data-autofocus]"
    >
      {state ? (
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-6 text-ink">
          <li>You lose your role and the workspace tools that come with it (for example hiring, training administration and billing).</li>
          <li>Jobs, posts and courses you created for {organizationName} stay with the organization.</li>
          <li>The {organizationName} badge is removed from your profile and your Home card.</li>
          <li>You can ask to join again later; an administrator will review the request.</li>
        </ul>
      ) : null}
      {error ? <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} disabled={pending} data-autofocus className={secondaryButton}>Cancel</button>
        {state ? (
          <button type="button" onClick={leave} disabled={pending} className={dangerButton}>
            {pending ? 'Leaving…' : 'Leave organization'}
          </button>
        ) : null}
      </div>
    </FeedDialog>
  )

  return typeof document === 'undefined' ? null : createPortal(dialog, document.body)
}

/** "Leave organization" on the "You are part of …" card. */
export function LeaveOrganizationButton({ companyId, organizationName, className = '' }: {
  companyId: string
  organizationName: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={`inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 ${className}`}
      >
        <LogOut aria-hidden="true" className="size-4" /> Leave organization
      </button>
      {open ? <LeaveOrganizationDialog companyId={companyId} organizationName={organizationName} onClose={() => setOpen(false)} returnFocusRef={triggerRef} /> : null}
    </>
  )
}

/** Opens the leave dialog when the organization page's "…" menu asks for it. */
export function LeaveOrganizationMenuHost({ companyId, organizationName }: { companyId: string; organizationName: string }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    function onOpen(event: Event) {
      if ((event as CustomEvent<string>).detail === companyId) setOpen(true)
    }
    window.addEventListener(ORGANIZATION_LEAVE_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(ORGANIZATION_LEAVE_OPEN_EVENT, onOpen)
  }, [companyId])
  return open ? <LeaveOrganizationDialog companyId={companyId} organizationName={organizationName} onClose={() => setOpen(false)} /> : null
}

/** The "⋯" menu on each card in Organizations › Your pages. */
export function OrganizationCardMenu({ companyId, organizationName }: { companyId: string; organizationName: string }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuId = useId()
  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`More actions for ${organizationName}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuId}
        onClick={() => setMenuOpen((open) => !open)}
        className="grid size-9 cursor-pointer place-items-center rounded-lg border border-mist-200 bg-white text-navy-950 hover:bg-mist-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500"
      >
        <MoreHorizontal aria-hidden="true" className="size-5" />
      </button>
      <ActionMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchorRef={triggerRef}
        id={menuId}
        label={`More actions for ${organizationName}`}
        align="end"
        className="w-56 shadow-[var(--shadow-card)]"
      >
        <ActionMenuItem
          onClick={() => { setMenuOpen(false); setLeaveOpen(true) }}
          className="py-2 text-red-700"
          icon={<LogOut aria-hidden="true" className="size-4" />}
        >
          Leave organization
        </ActionMenuItem>
      </ActionMenu>
      {leaveOpen ? <LeaveOrganizationDialog companyId={companyId} organizationName={organizationName} onClose={() => setLeaveOpen(false)} returnFocusRef={triggerRef} /> : null}
    </div>
  )
}
