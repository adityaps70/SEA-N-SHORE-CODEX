import { Anchor, MapPin, Ship, TimerReset } from 'lucide-react'
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

export function ProfileHeader({ profile }: { profile: PublicProfile }) {
  return (
    <section className="overflow-hidden rounded-[1.75rem] border border-mist-100 bg-white shadow-[var(--shadow-card)]">
      <div className="h-28 bg-[linear-gradient(115deg,var(--navy-950),var(--ocean-700)_58%,var(--teal-500))] sm:h-36" />
      <div className="px-5 pb-6 sm:px-8 sm:pb-8">
        <div className="-mt-10 flex flex-col gap-5 sm:-mt-12 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 items-end gap-4">
            <div className="grid size-20 shrink-0 place-items-center rounded-2xl border-4 border-white bg-mist-100 text-xl font-semibold text-navy-950 shadow-sm sm:size-24 sm:text-2xl">
              {initials(profile.fullName)}
            </div>
            <div className="min-w-0 pb-1">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-mist-50 px-2.5 py-1 text-xs font-semibold text-ocean-700">
                <Anchor aria-hidden="true" className="size-3.5" />
                {profileTypeLabels[profile.profileType]}
              </span>
              <h1 className="mt-2 truncate text-3xl font-semibold tracking-[-.035em] text-navy-950 sm:text-4xl">
                {profile.fullName}
              </h1>
            </div>
          </div>
          {profile.availability ? (
            <span className="inline-flex w-fit items-center gap-2 rounded-xl border border-mist-100 bg-mist-50 px-3 py-2 text-sm font-medium text-navy-900">
              <TimerReset aria-hidden="true" className="size-4 text-teal-500" />
              {profile.availability}
            </span>
          ) : null}
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
