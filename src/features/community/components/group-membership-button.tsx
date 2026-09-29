'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Check, Clock3, Loader2, LogOut, Plus } from 'lucide-react'
import { cn } from '@/lib/cn'
import { joinGroup, leaveGroup } from '../actions'
import type { GroupRole, GroupVisibility, MembershipStatus } from '../types'

/**
 * Join / Request to join / Pending / Joined (cards) or Join / Leave / Pending (group page).
 * The server decides the membership; this island only reflects it.
 */
export function GroupMembershipButton({
  groupId,
  groupName,
  visibility,
  initialStatus,
  role,
  appearance = 'card',
  className = '',
}: {
  groupId: string
  groupName: string
  visibility: GroupVisibility
  initialStatus: MembershipStatus | null
  role: GroupRole | null
  appearance?: 'card' | 'page'
  className?: string
}) {
  const router = useRouter()
  const [status, setStatus] = useState<MembershipStatus | null>(initialStatus)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  const base = appearance === 'page'
    ? 'inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 max-md:min-h-11 max-md:flex-1 max-md:rounded-full max-md:text-[15px]'
    : 'inline-flex min-h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-60'
  const primary = 'bg-navy-950 text-white hover:bg-navy-900'
  const outline = 'border border-mist-200 bg-white text-navy-950 hover:border-ocean-300 hover:bg-ocean-50'

  function join() {
    setError('')
    startTransition(async () => {
      const result = await joinGroup(groupId).catch(() => null)
      if (!result || !result.ok) {
        setError(result?.error ?? 'We could not join this group. Check your connection and try again.')
        return
      }
      setStatus(result.status)
      router.refresh()
    })
  }

  function leave() {
    const question = status === 'pending'
      ? `Withdraw your request to join ${groupName}?`
      : `Leave ${groupName}? You can join again later.`
    if (typeof window !== 'undefined' && !window.confirm(question)) return
    setError('')
    startTransition(async () => {
      const result = await leaveGroup(groupId).catch(() => null)
      if (!result || !result.ok) {
        setError(result?.error ?? 'We could not update your membership. Check your connection and try again.')
        return
      }
      setStatus(null)
      router.refresh()
    })
  }

  let button: React.ReactNode
  if (status === 'active' && role === 'owner') {
    button = appearance === 'page'
      ? <span className={cn(base, 'cursor-default border border-mist-200 bg-mist-50 text-navy-950')}><Check aria-hidden="true" className="size-4" /> Owner</span>
      : <span className={cn(base, 'cursor-default border border-mist-200 bg-mist-50 text-navy-950')}><Check aria-hidden="true" className="size-3.5" /> Owner</span>
  } else if (status === 'active') {
    button = appearance === 'page' ? (
      <button type="button" onClick={leave} disabled={pending} className={cn(base, outline, className)}>
        {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <LogOut aria-hidden="true" className="size-4" />} Leave group
      </button>
    ) : (
      <span aria-label={`Joined ${groupName}`} className={cn(base, 'cursor-default border border-emerald-200 bg-emerald-50 text-emerald-800', className)}>
        <Check aria-hidden="true" className="size-3.5" /> Joined
      </span>
    )
  } else if (status === 'pending') {
    button = (
      <button type="button" onClick={leave} disabled={pending} aria-label={`Pending: withdraw your request to join ${groupName}`} className={cn(base, 'border border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100', className)}>
        {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Clock3 aria-hidden="true" className="size-4" />} Pending
      </button>
    )
  } else {
    const label = visibility === 'private' ? 'Request to join' : 'Join'
    button = (
      <button type="button" onClick={join} disabled={pending} aria-label={`${label} ${groupName}`} className={cn(base, appearance === 'page' ? primary : primary, className)}>
        {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Plus aria-hidden="true" className="size-4" strokeWidth={2.5} />} {label}
      </button>
    )
  }

  return (
    <div className={appearance === 'page' ? 'flex min-w-0 flex-col gap-1 max-md:flex-1' : 'min-w-0'}>
      {button}
      {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
    </div>
  )
}
