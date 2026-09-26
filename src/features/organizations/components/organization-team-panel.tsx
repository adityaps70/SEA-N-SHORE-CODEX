'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { CheckCircle2, Loader2, ShieldAlert } from 'lucide-react'
import type { OrganizationAccessRole } from '@/features/access/policy'
import { updateOrganizationMemberRole } from '../workspace-actions'
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

export function OrganizationTeamPanel({
  companyId,
  members,
}: {
  companyId: string
  members: OrganizationWorkspaceMember[]
}) {
  const [rows, setRows] = useState(members)
  const [pendingMember, setPendingMember] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [isPending, startTransition] = useTransition()

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

              {member.role === 'owner' ? (
                <span className="rounded-full bg-navy-950 px-3 py-1.5 text-xs font-bold text-white">Owner</span>
              ) : (
                <div className="flex items-center gap-2">
                  <select
                    aria-label={'Role for ' + member.fullName}
                    value={member.role}
                    disabled={isPending && pendingMember === member.userId}
                    onChange={(event) => changeRole(member.userId, event.target.value as Exclude<OrganizationAccessRole, 'owner'>)}
                    className="min-h-10 rounded-xl border border-mist-100 bg-white px-3 text-sm font-semibold text-navy-950"
                  >
                    {assignable.map((role) => <option key={role} value={role}>{labels[role]}</option>)}
                  </select>
                  {isPending && pendingMember === member.userId ? <Loader2 aria-hidden="true" className="size-4 animate-spin text-ocean-700" /> : null}
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
