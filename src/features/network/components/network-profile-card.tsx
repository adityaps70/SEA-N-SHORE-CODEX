'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MapPin, Ship, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { NetworkProfile } from '../types'
import { ConnectionPrimaryAction } from './connection-primary-action'

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

export function NetworkProfileCard({ profile }: { profile: NetworkProfile }) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  const maritimeContext = [profile.rank, profile.currentCompany].filter(Boolean).join(' · ')
  const secondaryContext = profile.location || profile.vesselTypes[0] || profile.skills[0] || 'Maritime professional'

  return (
    <Card className="relative flex h-full min-h-[23rem] flex-col overflow-hidden border border-mist-100 bg-white p-0">
      <div className="h-24 bg-[linear-gradient(135deg,var(--navy-950),var(--ocean-700)_58%,var(--teal-500))]" />
      <button
        type="button"
        aria-label={`Dismiss ${profile.fullName} suggestion`}
        onClick={() => setDismissed(true)}
        className="absolute right-3 top-3 grid size-9 place-items-center rounded-full bg-navy-950/80 text-white shadow-sm backdrop-blur transition hover:bg-navy-950"
      >
        <X aria-hidden="true" className="size-5" />
      </button>

      <div className="-mt-12 flex justify-center px-5">
        {profile.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- profile media is a short-lived external signed URL
          <img
            src={profile.avatarUrl}
            alt={`${profile.fullName} profile`}
            loading="lazy"
            className="size-24 rounded-full border-4 border-white object-cover shadow-sm ring-1 ring-mist-100"
          />
        ) : (
          <div className="grid size-24 place-items-center rounded-full border-4 border-white bg-mist-100 text-lg font-semibold text-navy-950 shadow-sm ring-1 ring-mist-100">
            {initials(profile.fullName)}
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col px-5 pb-5 pt-3 text-center">
        <Link href={`/people/${profile.slug}`} className="text-lg font-semibold text-navy-950 hover:text-ocean-700">
          {profile.fullName}
        </Link>
        <p className="mt-1 min-h-10 line-clamp-2 text-sm leading-5 text-muted">
          {profile.headline ?? profile.summary ?? 'Maritime professional'}
        </p>

        <div className="mt-4 space-y-2 text-left text-xs text-muted">
          {maritimeContext ? (
            <p className="flex min-w-0 items-center gap-2">
              <Ship aria-hidden="true" className="size-4 shrink-0 text-ocean-700" />
              <span className="truncate">{maritimeContext}</span>
            </p>
          ) : null}
          <p className="flex min-w-0 items-center gap-2">
            <MapPin aria-hidden="true" className="size-4 shrink-0 text-ocean-700" />
            <span className="truncate">{secondaryContext}</span>
          </p>
        </div>

        <div className="mt-auto pt-5">
          <ConnectionPrimaryAction profileId={profile.id} initialRelationship={profile.relationship} />
        </div>
      </div>
    </Card>
  )
}
