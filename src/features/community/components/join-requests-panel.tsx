'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { MediaImage } from '@/components/ui/media-image'
import { approveAllPending, approveJoinRequest, declineJoinRequest } from '../actions'
import type { GroupMember } from '../types'

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'SN'
}

/**
 * Waiting join requests with Approve / Decline per row and "Approve all pending" for the
 * moderators. Shown whenever requests exist: switching the join setting to Open never
 * approves anything by itself (round 9C).
 */
export function JoinRequestsPanel({ groupId, requests }: { groupId: string; requests: GroupMember[] }) {
  const router = useRouter()
  const [items, setItems] = useState(requests)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  function approveAll() {
    if (typeof window !== 'undefined' && !window.confirm(`Approve all ${items.length} waiting ${items.length === 1 ? 'request' : 'requests'}?`)) return
    setError('')
    setBusyId('all')
    startTransition(async () => {
      const result = await approveAllPending(groupId).catch(() => null)
      setBusyId(null)
      if (!result || !result.ok) {
        setError(result?.error ?? 'We could not approve these requests. Check your connection and try again.')
        return
      }
      setItems([])
      router.refresh()
    })
  }

  function decide(profileId: string, approve: boolean) {
    setError('')
    setBusyId(profileId)
    startTransition(async () => {
      const result = await (approve ? approveJoinRequest({ groupId, profileId }) : declineJoinRequest({ groupId, profileId })).catch(() => null)
      setBusyId(null)
      if (!result || !result.ok) {
        setError(result?.error ?? 'We could not update this request. Check your connection and try again.')
        return
      }
      setItems((current) => current.filter((item) => item.profileId !== profileId))
      router.refresh()
    })
  }

  if (!items.length) {
    return <p className="text-sm text-muted">No join requests waiting.</p>
  }

  const approvingAll = pending && busyId === 'all'
  return (
    <div className="space-y-3">
      {error ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{items.length} waiting. Approved members are told at once.</p>
        <button type="button" disabled={pending} onClick={approveAll} className="inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-ocean-200 bg-ocean-50 px-3 text-xs font-bold text-ocean-800 hover:bg-ocean-100 disabled:opacity-60 max-md:min-h-11 max-md:w-full max-md:justify-center">
          {approvingAll ? 'Approving…' : 'Approve all pending'}
        </button>
      </div>
      <ul className="divide-y divide-mist-100">
        {items.map((member) => {
          const fallback = <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-mist-100 text-sm font-semibold text-navy-950">{initials(member.fullName)}</span>
          const busy = pending && busyId === member.profileId
          return (
            <li key={member.profileId} className="flex flex-wrap items-center gap-3 py-3">
              {member.avatarUrl ? <MediaImage avatar src={member.avatarUrl} alt="" width={44} height={44} sizes="44px" className="size-11 shrink-0 rounded-full object-cover ring-1 ring-mist-100" fallback={fallback} /> : fallback}
              <div className="min-w-0 flex-1">
                {member.slug ? <Link href={`/people/${member.slug}`} className="block truncate font-semibold text-navy-950 hover:text-ocean-700 hover:underline">{member.fullName}</Link> : <p className="truncate font-semibold text-navy-950">{member.fullName}</p>}
                <p className="truncate text-sm text-muted">{member.headline || 'Maritime professional'}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" disabled={busy} onClick={() => decide(member.profileId, true)} aria-label={`Approve ${member.fullName}`} className="inline-flex min-h-9 cursor-pointer items-center rounded-lg bg-navy-950 px-3 text-xs font-bold text-white hover:bg-navy-900 disabled:opacity-60">
                  {busy ? 'Working…' : 'Approve'}
                </button>
                <button type="button" disabled={busy} onClick={() => decide(member.profileId, false)} aria-label={`Decline ${member.fullName}`} className="inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-mist-200 bg-white px-3 text-xs font-bold text-navy-950 hover:bg-mist-50 disabled:opacity-60">
                  Decline
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
