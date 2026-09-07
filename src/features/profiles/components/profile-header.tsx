/* eslint-disable @next/next/no-img-element */
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Anchor, MapPin, Pencil, Ship, TimerReset } from 'lucide-react'
import type { PublicProfile } from '../types'

const profileTypeLabels: Record<PublicProfile['profileType'], string> = {
  seafarer: 'Seafarer',
  maritime_professional: 'Maritime Professional',
  company: 'Company',
  trainer: 'Trainer',
  mentor: 'Mentor',
  recruiter: 'Recruiter',
  service_provider: 'Maritime Service Provider',
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

export function ProfileHeader({
  profile,
  actions,
  editHref,
  mediaControls,
  avatarControls,
}: {
  profile: PublicProfile
  actions?: ReactNode
  editHref?: string
  mediaControls?: ReactNode
  avatarControls?: ReactNode
}) {
  const identityLabel = profile.primaryIdentity ?? profileTypeLabels[profile.profileType]
  const secondaryIdentities = profile.secondaryIdentities ?? []

  return (
    <section className="overflow-hidden rounded-[1.75rem] border border-mist-100 bg-white shadow-[var(--shadow-card)]">
      <div className="relative h-36 overflow-hidden bg-[linear-gradient(115deg,var(--navy-950),var(--ocean-700)_58%,var(--teal-500))] sm:h-48">
        {profile.coverUrl ? (
          <img
            src={profile.coverUrl}
            alt={`${profile.fullName} cover photo`}
            className="h-full w-full object-cover"
          />
        ) : null}
        {mediaControls ? <div className="absolute right-4 top-4 z-10">{mediaControls}</div> : null}
      </div>

      <div className="px-5 pb-6 sm:px-8 sm:pb-8">
        <div className="-mt-12 flex flex-col gap-5 sm:-mt-14 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 items-end gap-4">
            <div className="relative shrink-0">
              <div className="grid size-24 place-items-center overflow-hidden rounded-2xl border-4 border-white bg-mist-100 text-xl font-semibold text-navy-950 shadow-sm sm:size-28 sm:text-2xl">
                {profile.avatarUrl ? (
                  <img
                    src={profile.avatarUrl}
                    alt={`${profile.fullName} profile photo`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  initials(profile.fullName)
                )}
              </div>
              {avatarControls ? <div className="absolute -bottom-1 -right-1 z-10">{avatarControls}</div> : null}
            </div>
            <div className="min-w-0 pb-1">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-mist-50 px-2.5 py-1 text-xs font-semibold text-ocean-700">
                <Anchor aria-hidden="true" className="size-3.5" />
                {identityLabel}
              </span>
              <div className="mt-2 flex min-w-0 items-center gap-2">
                <h1 className="truncate text-3xl font-semibold tracking-[-.035em] text-navy-950 sm:text-4xl">
                  {profile.fullName}
                </h1>
                {editHref ? (
                  <Link
                    href={editHref}
                    aria-label="Edit basic information"
                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-mist-100 text-navy-950 hover:border-ocean-500 hover:text-ocean-700"
                  >
                    <Pencil aria-hidden="true" className="size-4" />
                  </Link>
                ) : null}
              </div>
              {secondaryIdentities.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {secondaryIdentities.map((identity) => (
                    <span key={identity} className="rounded-full bg-ocean-50 px-2.5 py-1 text-xs font-medium text-ocean-800">
                      {identity}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col items-start gap-3 sm:items-end">
            {profile.availability ? (
              <span className="inline-flex w-fit items-center gap-2 rounded-xl border border-mist-100 bg-mist-50 px-3 py-2 text-sm font-medium text-navy-900">
                <TimerReset aria-hidden="true" className="size-4 text-teal-500" />
                {profile.availability}
              </span>
            ) : null}
            {actions ? <div className="w-full sm:w-auto">{actions}</div> : null}
          </div>
        </div>

        {profile.headline ? (
          <p className="mt-5 max-w-3xl text-lg font-medium leading-7 text-ink">{profile.headline}</p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
          {profile.location ? (
            <span className="inline-flex items-center gap-1.5">
              <MapPin aria-hidden="true" className="size-4" />
              {profile.location}
            </span>
          ) : null}
          {profile.currentCompany ? (
            <span className="inline-flex items-center gap-1.5">
              <Ship aria-hidden="true" className="size-4" />
              {profile.currentCompany}
            </span>
          ) : null}
        </div>
      </div>
    </section>
  )
}
