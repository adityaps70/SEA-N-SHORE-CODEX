'use client'

import { useState, useTransition } from 'react'
import { Check, Loader2, Plus, UsersRound } from 'lucide-react'
import { followOrganizationAction, unfollowOrganizationAction } from '../follow-actions'

/**
 * - `default`: filled button with the follower count beside it.
 * - `page`: outline button for the organization page header (count shown in the meta line).
 * - `card`: small full-width outline button for organization cards.
 */
type Appearance = 'default' | 'page' | 'card'

export function OrganizationFollowButton({
  companyId,
  initialFollowing,
  initialFollowerCount,
  appearance = 'default',
  organizationName,
}: {
  companyId: string
  initialFollowing: boolean
  initialFollowerCount: number
  appearance?: Appearance
  /** Used for the accessible name where several follow buttons share a screen. */
  organizationName?: string
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
      try {
        const result = next
          ? await followOrganizationAction(companyId)
          : await unfollowOrganizationAction(companyId)

        if (!result.ok) {
          setFollowing(previous)
          setFollowerCount((count) => Math.max(0, count + (next ? -1 : 1)))
          setError(result.error)
        }
      } catch {
        setFollowing(previous)
        setFollowerCount((count) => Math.max(0, count + (next ? -1 : 1)))
        setError('We could not update this follow. Check your connection and try again.')
      }
    })
  }

  const compact = appearance !== 'default'
  const label = following ? 'Following' : compact ? 'Follow' : 'Follow organization'
  const icon = pending
    ? <Loader2 aria-hidden="true" className="size-4 animate-spin" />
    : following
      ? <Check aria-hidden="true" className="size-4" />
      : compact
        ? <Plus aria-hidden="true" className="size-4" />
        : <UsersRound aria-hidden="true" className="size-4" />

  const base = 'inline-flex cursor-pointer items-center justify-center gap-2 font-bold transition disabled:cursor-wait disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500'
  const tone = appearance === 'default'
    ? (following
        ? 'min-h-10 rounded-xl border border-mist-200 bg-white px-4 text-sm text-navy-950 hover:bg-mist-50'
        : 'min-h-10 rounded-xl bg-navy-950 px-4 text-sm text-white hover:bg-navy-900')
    : (following
        ? 'border border-mist-200 bg-white text-navy-950 hover:border-navy-300 hover:bg-mist-50'
        : 'border border-ocean-600 bg-white text-ocean-800 hover:bg-ocean-50')
  const size = appearance === 'page'
    ? 'min-h-10 rounded-xl px-4 text-sm'
    : appearance === 'card'
      ? 'min-h-9 w-full rounded-lg px-3 text-xs'
      : ''

  const button = (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={following}
      aria-label={organizationName ? `${following ? 'Following' : 'Follow'} ${organizationName}` : undefined}
      className={`${base} ${tone} ${size}`}
    >
      {icon}
      {label}
    </button>
  )

  if (appearance !== 'default') {
    return (
      <div className={appearance === 'card' ? 'w-full' : 'min-w-0'}>
        {button}
        {error ? <p role="alert" className="mt-1 max-w-xs text-xs font-medium text-red-700">{error}</p> : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        {button}
        <span className="text-xs font-semibold text-muted">
          {followerCount.toLocaleString('en-IN')} {followerCount === 1 ? 'follower' : 'followers'}
        </span>
      </div>
      {error ? <p role="alert" className="max-w-sm text-xs font-medium text-red-700">{error}</p> : null}
    </div>
  )
}
