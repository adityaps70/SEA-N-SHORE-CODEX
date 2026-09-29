'use client'

import { useState, useTransition } from 'react'
import { Check, Loader2, Plus } from 'lucide-react'
import { cn } from '@/lib/cn'
import { followHashtag, unfollowHashtag } from '../actions'

/**
 * Follow / Following toggle for a hashtag page (round 9B). Optimistic: the label and the
 * follower count flip at once and roll back if the server action fails.
 */
export function HashtagFollowButton({
  tag,
  initialFollowing,
  initialFollowerCount,
  className,
}: {
  tag: string
  initialFollowing: boolean
  initialFollowerCount: number
  className?: string
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
        const result = next ? await followHashtag(tag) : await unfollowHashtag(tag)
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

  return (
    <div className={cn('flex flex-col items-start gap-1', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          aria-pressed={following}
          aria-label={`${following ? 'Following' : 'Follow'} #${tag}`}
          className={cn(
            'inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition disabled:cursor-wait disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 max-md:min-h-11 max-md:rounded-full max-md:text-[15px]',
            following
              ? 'border border-mist-200 bg-white text-navy-950 hover:bg-mist-50'
              : 'bg-navy-950 text-white hover:bg-navy-900 max-md:bg-ocean-700 max-md:hover:bg-ocean-800',
          )}
        >
          {pending
            ? <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            : following
              ? <Check aria-hidden="true" className="size-4" />
              : <Plus aria-hidden="true" className="size-4" />}
          {following ? 'Following' : 'Follow'}
        </button>
        <span data-testid="hashtag-follower-count" className="text-xs font-semibold text-muted">
          {followerCount.toLocaleString('en-IN')} {followerCount === 1 ? 'follower' : 'followers'}
        </span>
      </div>
      {error ? <p role="alert" className="max-w-sm text-xs font-medium text-red-700">{error}</p> : null}
    </div>
  )
}
