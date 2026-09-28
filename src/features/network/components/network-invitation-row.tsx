'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Check, X } from 'lucide-react'
import { acceptConnectionRequest, declineConnectionRequest } from '../actions'
import type { NetworkProfile } from '../types'

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

/**
 * Phone invitation row on My Network: photo, name, role line, then round ✕ (Decline) and
 * ✓ (Accept) buttons. The full Requests tab keeps the richer request cards.
 */
export function NetworkInvitationRow({ profile }: { profile: NetworkProfile }) {
  const router = useRouter()
  const [outcome, setOutcome] = useState<'accepted' | 'declined' | null>(null)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const connectionId = profile.relationship.connection.connectionId
  const roleLine = [profile.rank, profile.currentCompany].filter(Boolean).join(' · ') || profile.headline || 'Maritime professional'

  function respond(action: 'accept' | 'decline') {
    if (!connectionId || pending) return
    setError('')
    startTransition(async () => {
      const result = action === 'accept'
        ? await acceptConnectionRequest(connectionId)
        : await declineConnectionRequest(connectionId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setOutcome(action === 'accept' ? 'accepted' : 'declined')
      router.refresh()
    })
  }

  const roundButton = 'grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border transition disabled:cursor-wait disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500'

  return (
    <article className="flex items-center gap-3 py-3">
      <Link href={`/people/${profile.slug}`} className="shrink-0 rounded-full" aria-label={`View ${profile.fullName} profile`}>
        {profile.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- profile media is a short-lived external signed URL
          <img src={profile.avatarUrl} alt="" loading="lazy" className="size-14 rounded-full object-cover ring-1 ring-mist-100" />
        ) : (
          <span className="grid size-14 place-items-center rounded-full bg-mist-100 text-base font-semibold text-navy-950">
            {initials(profile.fullName)}
          </span>
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/people/${profile.slug}`} className="block truncate text-[15px] font-semibold text-navy-950 hover:underline">
          {profile.fullName}
        </Link>
        <p className="line-clamp-2 text-[13px] leading-5 text-muted">{roleLine}</p>
        {error ? <p role="alert" className="mt-1 text-xs font-medium text-red-700">{error}</p> : null}
      </div>
      {outcome ? (
        <p role="status" className="shrink-0 text-[13px] font-semibold text-muted">
          {outcome === 'accepted' ? 'Connected' : 'Declined'}
        </p>
      ) : (
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={pending || !connectionId}
            onClick={() => respond('decline')}
            aria-label={`Decline invitation from ${profile.fullName}`}
            className={`${roundButton} border-mist-300 text-navy-700 hover:bg-mist-50`}
          >
            <X aria-hidden="true" className="size-5" />
          </button>
          <button
            type="button"
            disabled={pending || !connectionId}
            onClick={() => respond('accept')}
            aria-label={`Accept invitation from ${profile.fullName}`}
            className={`${roundButton} border-ocean-700 text-ocean-700 hover:bg-ocean-50`}
          >
            <Check aria-hidden="true" className="size-5" />
          </button>
        </div>
      )}
    </article>
  )
}
