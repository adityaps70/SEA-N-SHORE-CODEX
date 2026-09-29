'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { Ban, Loader2 } from 'lucide-react'
import { unblockProfile } from '@/features/network/actions'

export type BlockedMemberItem = {
  id: string
  fullName: string
  slug: string | null
  headline: string | null
  avatarUrl: string | null
  blockedOn: string
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?'
}

function BlockedMemberRow({ member }: { member: BlockedMemberItem }) {
  const [pending, startTransition] = useTransition()
  const [unblocked, setUnblocked] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function onUnblock() {
    setError(null)
    startTransition(async () => {
      const result = await unblockProfile(member.id)
      if (result.ok) setUnblocked(true)
      else setError(result.error)
    })
  }

  const avatar = member.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- profile media is a short-lived signed URL
    <img src={member.avatarUrl} alt="" loading="lazy" className="size-12 shrink-0 rounded-full object-cover ring-1 ring-mist-100" />
  ) : (
    <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-mist-100 text-sm font-semibold text-navy-950">
      {initials(member.fullName)}
    </span>
  )

  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      {avatar}
      <div className="min-w-0 flex-1">
        {member.slug && unblocked ? (
          <Link href={`/people/${member.slug}`} className="block truncate text-[15px] font-semibold text-navy-950 hover:text-ocean-700 hover:underline">
            {member.fullName}
          </Link>
        ) : (
          <p className="truncate text-[15px] font-semibold text-navy-950">{member.fullName}</p>
        )}
        {member.headline ? <p className="truncate text-sm text-muted">{member.headline}</p> : null}
        <p className="text-xs text-muted">{unblocked ? 'Unblocked' : `Blocked ${member.blockedOn}`}</p>
        {error ? <p role="alert" className="mt-1 text-sm font-medium text-red-700">{error}</p> : null}
      </div>
      {unblocked ? (
        <span role="status" className="shrink-0 text-sm font-semibold text-teal-700">Unblocked</span>
      ) : (
        <button
          type="button"
          onClick={onUnblock}
          disabled={pending}
          aria-label={`Unblock ${member.fullName}`}
          className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-full border border-ocean-700 px-4 text-sm font-semibold text-ocean-700 transition hover:bg-ocean-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
          {pending ? 'Unblocking…' : 'Unblock'}
        </button>
      )}
    </li>
  )
}

/** Members the viewer blocked, each with an Unblock button (Settings → Blocked members). */
export function BlockedMembersList({ members }: { members: BlockedMemberItem[] }) {
  if (!members.length) {
    return (
      <div className="px-6 py-10 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-mist-50 text-muted">
          <Ban aria-hidden="true" className="size-5" />
        </span>
        <p className="mt-3 font-semibold text-navy-950">You haven’t blocked anyone.</p>
        <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted">
          When you block someone from their profile, they appear here and you can unblock them at any time.
        </p>
        <Link href="/network" className="mt-4 inline-flex min-h-11 items-center rounded-full bg-ocean-700 px-5 text-sm font-semibold text-white hover:bg-navy-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500">
          Go to My Network
        </Link>
      </div>
    )
  }
  return (
    <ul aria-label="Blocked members" className="divide-y divide-mist-100">
      {members.map((member) => <BlockedMemberRow key={member.id} member={member} />)}
    </ul>
  )
}
