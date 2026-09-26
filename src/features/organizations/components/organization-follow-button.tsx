'use client'

import { useState, useTransition } from 'react'
import { Check, Loader2, UsersRound } from 'lucide-react'
import { followOrganizationAction, unfollowOrganizationAction } from '../follow-actions'

export function OrganizationFollowButton({
  companyId,
  initialFollowing,
  initialFollowerCount,
}: {
  companyId: string
  initialFollowing: boolean
  initialFollowerCount: number
}) {
  const [following, setFollowing] = useState(initialFollowing)
  const [followerCount, setFollowerCount] = useState(initialFollowerCount)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function toggle() {
    const previous = following
    const next = !previous
    setFollowing(next)
    setFollowerCount((count) => Math.max(0, count + (next ? 1 : -1)))
    setError('')

    startTransition(async () => {
      const result = next
        ? await followOrganizationAction(companyId)
        : await unfollowOrganizationAction(companyId)

      if (!result.ok) {
        setFollowing(previous)
        setFollowerCount((count) => Math.max(0, count + (next ? -1 : 1)))
        setError(result.error)
      }
    })
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          aria-pressed={following}
          className={
            'inline-flex min-h-10 items-center gap-2 rounded-xl px-4 text-sm font-bold transition disabled:opacity-60 '
            + (following
              ? 'border border-mist-100 bg-white text-navy-950'
              : 'bg-navy-950 text-white')
          }
        >
          {pending
            ? <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            : following
              ? <Check aria-hidden="true" className="size-4" />
              : <UsersRound aria-hidden="true" className="size-4" />}
          {following ? 'Following' : 'Follow organization'}
        </button>
        <span className="text-xs font-semibold text-muted">
          {followerCount.toLocaleString('en-IN')} {followerCount === 1 ? 'follower' : 'followers'}
        </span>
      </div>
      {error ? <p role="alert" className="max-w-sm text-xs font-medium text-red-700">{error}</p> : null}
    </div>
  )
}
