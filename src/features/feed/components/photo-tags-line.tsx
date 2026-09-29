'use client'

import { MediaImage } from '@/components/ui/media-image'
import Link from 'next/link'
import { UsersRound } from 'lucide-react'
import { useRef, useState } from 'react'
import type { FeedPhotoTag } from '../types'
import { initials, profileHref } from './author-avatar'
import { FeedDialog } from './feed-dialog'

/** One entry per person, even when they are tagged in several photos of the post. */
export function uniquePhotoTagPeople(tags: FeedPhotoTag[]) {
  const seen = new Set<string>()
  return tags.filter((tag) => {
    if (seen.has(tag.profileId)) return false
    seen.add(tag.profileId)
    return true
  })
}

/**
 * "with Priya Nair and 2 others" under a post's photos (round 9B). The first name opens
 * that profile; "and N others" opens the full list. One truncated line on phones.
 */
export function PhotoTagsLine({ tags, className = '' }: { tags: FeedPhotoTag[]; className?: string }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const people = uniquePhotoTagPeople(tags)
  const first = people[0]
  if (!first) return null
  const others = people.length - 1

  return (
    <>
      <p data-testid="post-photo-tags" className={`mt-2 flex min-w-0 items-center gap-1.5 truncate text-sm text-muted ${className}`}>
        <UsersRound aria-hidden="true" className="size-4 shrink-0 text-ocean-700" />
        <span className="min-w-0 truncate">
          with{' '}
          <Link href={profileHref(first.slug)} className="font-semibold text-navy-950 hover:text-ocean-700 hover:underline">
            {first.fullName}
          </Link>
          {others > 0 ? (
            <>
              {' '}and{' '}
              <button
                ref={triggerRef}
                type="button"
                onClick={() => setOpen(true)}
                aria-haspopup="dialog"
                className="cursor-pointer font-semibold text-navy-950 hover:text-ocean-700 hover:underline"
              >
                {others} {others === 1 ? 'other' : 'others'}
              </button>
            </>
          ) : null}
        </span>
      </p>

      {open ? (
        <FeedDialog title="Tagged in this post" onClose={() => setOpen(false)} closeLabel="Close tagged people" returnFocusRef={triggerRef} size="sm">
          <ul aria-label="Tagged people" className="divide-y divide-mist-100 rounded-2xl border border-mist-100">
            {people.map((person) => (
              <li key={person.profileId}>
                <Link href={profileHref(person.slug)} className="flex min-h-14 items-center gap-3 px-3 py-2 hover:bg-mist-50">
                  <span aria-hidden="true" className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-mist-100 text-xs font-semibold text-navy-950">
                    {person.avatarUrl ? (
                      <MediaImage avatar src={person.avatarUrl} alt="" fill sizes="40px" className="object-cover" fallback={initials(person.fullName)} />
                    ) : initials(person.fullName)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-navy-950">{person.fullName}</span>
                </Link>
              </li>
            ))}
          </ul>
        </FeedDialog>
      ) : null}
    </>
  )
}
