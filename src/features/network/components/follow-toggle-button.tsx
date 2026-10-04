'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { followProfile, unfollowProfile } from '../actions'

export function FollowToggleButton({
  profileId,
  following,
  followerView = false,
}: {
  profileId: string
  following: boolean
  followerView?: boolean
}) {
  const router = useRouter()
  const [isFollowing, setIsFollowing] = useState(following)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function toggle() {
    const previous = isFollowing
    const next = !previous
    setIsFollowing(next)
    setError('')
    startTransition(async () => {
      const result = next ? await followProfile(profileId) : await unfollowProfile(profileId)
      if (!result.ok) {
        setIsFollowing(previous)
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  const label = isFollowing ? 'Following' : followerView ? 'Follow back' : 'Follow'

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={toggle}
        className="inline-flex min-h-10 items-center justify-center rounded-full border border-navy-900 px-5 text-sm font-semibold text-navy-900 transition hover:bg-mist-50 disabled:opacity-60"
      >
        {label}
      </button>
      {error ? <p role="alert" className="max-w-48 text-right text-xs font-medium text-red-700">{error}</p> : null}
    </div>
  )
}
