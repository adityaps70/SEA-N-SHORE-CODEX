'use client'

import { MediaImage } from '@/components/ui/media-image'
import { useState } from 'react'
import Link from 'next/link'
import { MapPin, Ship, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { NetworkProfile } from '../types'
import { ConnectionPrimaryAction } from './connection-primary-action'
import { PersonCardActions } from './person-card-actions'

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

/**
 * `actions="full"` (search results): the whole action set of a network card — Connect /
 * Pending / Accept / Message, Follow, View profile and a "…" menu — instead of one button.
 */
export function NetworkProfileCard({ profile, actions = 'primary' }: { profile: NetworkProfile; actions?: 'primary' | 'full' }) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  const maritimeContext = [profile.rank, profile.currentCompany].filter(Boolean).join(' · ')
  const secondaryContext = profile.location || profile.vesselTypes[0] || profile.skills[0] || 'Maritime professional'

  const profileInitials = (
    <div className="grid size-24 place-items-center rounded-full border-4 border-white bg-mist-100 text-lg font-semibold text-navy-950 shadow-sm ring-1 ring-mist-100 max-md:size-18 max-md:border-[3px]">
      {initials(profile.fullName)}
    </div>
  )

  return (
    <Card data-testid="network-profile-card" className="relative flex h-full min-h-[23rem] flex-col overflow-hidden border border-mist-100 bg-white p-0 max-md:min-h-0 max-md:rounded-2xl max-md:shadow-none">
      <div className="h-24 bg-[linear-gradient(135deg,var(--navy-950),var(--ocean-700)_58%,var(--teal-500))] max-md:h-14 max-md:bg-[linear-gradient(135deg,var(--ocean-100),var(--mist-100))]" />
      <button
        type="button"
        aria-label={`Dismiss ${profile.fullName} suggestion`}
        onClick={() => setDismissed(true)}
        className="absolute right-3 top-3 grid size-9 place-items-center rounded-full bg-navy-950/80 text-white shadow-sm backdrop-blur transition hover:bg-navy-950 max-md:right-0 max-md:top-0 max-md:size-11 max-md:bg-transparent max-md:shadow-none max-md:backdrop-blur-none max-md:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500"
      >
        <span className="grid place-items-center max-md:size-8 max-md:rounded-full max-md:bg-white max-md:text-navy-950 max-md:shadow-sm">
          <X aria-hidden="true" className="size-5 max-md:size-4" />
        </span>
      </button>

      <div className="-mt-12 flex justify-center px-5 max-md:-mt-9 max-md:px-3">
        {profile.avatarUrl ? (
          <MediaImage
            avatar
            src={profile.avatarUrl}
            alt={`${profile.fullName} profile`}
            width={96}
            height={96}
            sizes="(max-width: 767px) 72px, 96px"
            className="size-24 rounded-full border-4 border-white object-cover shadow-sm ring-1 ring-mist-100 max-md:size-18 max-md:border-[3px]"
            fallback={profileInitials}
          />
        ) : profileInitials}
      </div>

      <div className="flex flex-1 flex-col px-5 pb-5 pt-3 text-center max-md:px-3 max-md:pb-3 max-md:pt-2">
        <Link href={`/people/${profile.slug}`} className="text-lg font-semibold text-navy-950 hover:text-ocean-700 hover:underline max-md:line-clamp-2 max-md:text-[15px] max-md:leading-5">
          {profile.fullName}
        </Link>
        <p className="mt-1 min-h-10 line-clamp-2 text-sm leading-5 text-muted max-md:min-h-0 max-md:text-[13px] max-md:leading-[1.125rem]">
          {profile.headline ?? profile.summary ?? 'Maritime professional'}
        </p>

        {/* Phones: the compact grid card shows name and headline; details are on the profile. */}
        <div className="mt-4 space-y-2 text-left text-xs text-muted max-md:hidden">
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

        <div className="mt-auto pt-5 max-md:pt-3">
          {actions === 'full'
            ? <PersonCardActions profileId={profile.id} slug={profile.slug} fullName={profile.fullName} initialRelationship={profile.relationship} />
            : <ConnectionPrimaryAction profileId={profile.id} initialRelationship={profile.relationship} />}
        </div>
      </div>
    </Card>
  )
}
