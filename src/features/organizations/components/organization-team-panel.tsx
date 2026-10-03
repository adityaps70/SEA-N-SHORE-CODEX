'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, MoreHorizontal, ShieldAlert, UserMinus, UserRound } from 'lucide-react'
import { BottomSheet, SheetRow } from '@/components/ui/mobile-sheet'
import type { OrganizationAccessRole } from '@/features/access/policy'
import { removeOrganizationMember, updateOrganizationMemberRole } from '../workspace-actions'
import type { OrganizationWorkspaceMember } from '../workspace-repository'

const labels: Record<OrganizationAccessRole, string> = {
  owner: 'Owner',
  administrator: 'Administrator',
  recruiter: 'Recruiter / HR',
  lms_manager: 'LMS Manager',
  event_manager: 'Event Manager',
  content_manager: 'Content Manager',
  analyst: 'Analyst',
  member: 'Member',
}

const assignable: Exclude<OrganizationAccessRole, 'owner'>[] = [
  'administrator',
  'recruiter',
  'lms_manager',
  'event_manager',
  'content_manager',
  'analyst',
  'member',
]

/**
 * Whether `viewer` may remove `member` from the team. Mirrors the server rules in
 * workspace-repository.removeMember: owners and administrators remove people, only an owner
 * removes an owner, and the last owner always stays (so they cannot leave either).
 */
export function canRemoveTeamMember(
  viewer: { userId: string; role: OrganizationAccessRole | null },
  member: { userId: string; role: OrganizationAccessRole },
  ownerCount: number,
) {
  if (viewer.role !== 'owner' && viewer.role !== 'administrator') return false
  if (member.role === 'owner') return viewer.role === 'owner' && ownerCount > 1
  return true
}

export function OrganizationTeamPanel({
  companyId,
  members,
  organizationSlug,
  viewer,
}: {
  companyId: string
  members: OrganizationWorkspaceMember[]
  /** Where to go after the viewer leaves the team themselves. */
  organizationSlug?: string
  /** The signed-in person and their role here; removal is offered only to owners and administrators. */
  viewer?: { userId: string; role: OrganizationAccessRole | null }
}) {
  const router = useRouter()
  const [rows, setRows] = useState(members)
  const [pendingMember, setPendingMember] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [isPending, startTransition] = useTransition()
  // Phone "…" sheet for one member row, and the confirmation step (sheet on phones, dialog on desktop).
  const [menuFor, setMenuFor] = useState<OrganizationWorkspaceMember | null>(null)
  const [confirmFor, setConfirmFor] = useState<OrganizationWorkspaceMember | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const ownerCount = rows.filter((member) => member.role === 'owner').length

  function removable(member: OrganizationWorkspaceMember) {
    return viewer ? canRemoveTeamMember(viewer, member, ownerCount) : false
  }

  function removeLabel(member: OrganizationWorkspaceMember) {
    return viewer && member.userId === viewer.userId ? 'Leave team' : 'Remove from team'
  }

  function askToRemove(member: OrganizationWorkspaceMember) {
    setMenuFor(null)
    setRemoveError(null)
    setConfirmFor(member)
  }

  function confirmRemove() {
    const member = confirmFor
    if (!member) return
    setPendingMember(member.userId)
    setRemoveError(null)
    startTransition(async () => {
      const result = await removeOrganizationMember({ companyId, memberId: member.userId })
      setPendingMember(null)
      if (!result.ok) {
        setRemoveError(result.error)
        return
      }
      setConfirmFor(null)
      if (result.left) {
        router.push(organizationSlug ? `/organizations/${organizationSlug}` : '/organizations')
        return
      }
      setRows((current) => current.filter((row) => row.userId !== member.userId))
      setFeedback({ tone: 'success', message: `${member.fullName} was removed from the team.` })
    })
  }

  function changeRole(memberId: string, role: Exclude<OrganizationAccessRole, 'owner'>) {
    setPendingMember(memberId)
    setFeedback(null)
    startTransition(async () => {
      const result = await updateOrganizationMemberRole({ companyId, memberId, role })
      if (!result.ok) {
        setFeedback({ tone: 'error', message: result.error })
        setPendingMember(null)
        return
      }
      setRows((current) => current.map((member) => member.userId === memberId ? { ...member, role } : member))
      setFeedback({ tone: 'success', message: 'Team role updated.' })
      setPendingMember(null)
    })
  }

  return (
    <div className="space-y-4">
      {feedback ? (
        <div role="status" className={'flex items-start gap-2 rounded-xl px-4 py-3 text-sm ' + (
          feedback.tone === 'success' ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'
        )}>
          {feedback.tone === 'success'
            ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            : <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
          {feedback.message}
        </div>
      ) : null}

      <div className="grid gap-3">
        {rows.map((member) => (
          <article key={member.userId} className="rounded-2xl border border-mist-100 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {member.slug ? (
                  <Link href={'/people/' + member.slug} className="font-bold text-navy-950 hover:underline">{member.fullName}</Link>
                ) : (
                  <p className="font-bold text-navy-950">{member.fullName}</p>
                )}
                <p className="mt-1 text-xs text-muted">Approved organization member</p>
              </div>

              <div className="flex items-center gap-2">
                {member.role === 'owner' ? (
                  <span className="rounded-full bg-navy-950 px-3 py-1.5 text-xs font-bold text-white">Owner</span>
                ) : (
                  <>
                    <select
                      aria-label={'Role for ' + member.fullName}
                      value={member.role}
                      disabled={isPending && pendingMember === member.userId}
                      onChange={(event) => changeRole(member.userId, event.target.value as Exclude<OrganizationAccessRole, 'owner'>)}
                      className="min-h-10 rounded-xl border border-mist-100 bg-white px-3 text-sm font-semibold text-navy-950 max-md:min-h-11 max-md:min-w-0 max-md:flex-1"
                    >
                      {assignable.map((role) => <option key={role} value={role}>{labels[role]}</option>)}
                    </select>
                    {isPending && pendingMember === member.userId ? <Loader2 aria-hidden="true" className="size-4 animate-spin text-ocean-700" /> : null}
                  </>
                )}
                {removable(member) ? (
                  <>
                    <button
                      type="button"
                      onClick={() => askToRemove(member)}
                      className="hidden min-h-10 cursor-pointer items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-red-700 transition hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 md:inline-flex"
                    >
                      <UserMinus aria-hidden="true" className="size-4" />
                      {removeLabel(member)}
                      <span className="sr-only">: {member.fullName}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`More actions for ${member.fullName}`}
                      aria-haspopup="dialog"
                      onClick={() => setMenuFor(member)}
                      className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-navy-700 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 md:hidden"
                    >
                      <MoreHorizontal aria-hidden="true" className="size-5" />
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>

      <BottomSheet open={menuFor !== null} onClose={() => setMenuFor(null)} title={menuFor?.fullName} desktop="hidden">
        {menuFor ? (
          <div role="menu" aria-label={`Actions for ${menuFor.fullName}`}>
            {menuFor.slug ? (
              <Link
                role="menuitem"
                href={'/people/' + menuFor.slug}
                className="flex min-h-14 w-full items-center gap-4 rounded-2xl px-4 text-[15px] font-semibold text-navy-950 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
              >
                <UserRound aria-hidden="true" className="size-5 shrink-0" /> View profile
              </Link>
            ) : null}
            <SheetRow role="menuitem" tone="danger" icon={<UserMinus aria-hidden="true" />} label={removeLabel(menuFor)} onClick={() => askToRemove(menuFor)} />
          </div>
        ) : null}
      </BottomSheet>

      <BottomSheet
        open={confirmFor !== null}
        onClose={() => { if (!isPending) setConfirmFor(null) }}
        title={confirmFor ? (viewer && confirmFor.userId === viewer.userId ? 'Leave this team?' : `Remove ${confirmFor.fullName}?`) : undefined}
        footer={confirmFor ? (
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <button
              type="button"
              disabled={isPending}
              onClick={() => setConfirmFor(null)}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border border-mist-300 px-5 text-sm font-semibold text-navy-700 transition hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={confirmRemove}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-red-700 px-5 text-sm font-bold text-white hover:bg-red-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 disabled:opacity-60"
            >
              {isPending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <UserMinus aria-hidden="true" className="size-4" />}
              {removeLabel(confirmFor)}
            </button>
          </div>
        ) : null}
      >
        {confirmFor ? (
          <div className="space-y-3 px-3 pb-2 text-sm leading-6 text-ink">
            <p>
              {viewer && confirmFor.userId === viewer.userId
                ? 'You will lose access to this organization\'s workspace tools. You can ask to join again later.'
                : `${confirmFor.fullName} will lose access to this organization's workspace tools straight away. They can ask to join again later.`}
            </p>
            {removeError ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 font-medium text-red-800">{removeError}</p> : null}
          </div>
        ) : null}
      </BottomSheet>
    </div>
  )
}
