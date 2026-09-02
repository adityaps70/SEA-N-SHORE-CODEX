import Link from 'next/link'
import { Anchor, BriefcaseBusiness, Clock3, Ship, Waves } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { OwnProfile } from '@/features/profiles/types'
import { calculateProfileCompletion } from '../profile-completion'

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

export function FeedProfileCard({ profile, compact = false }: { profile: OwnProfile; compact?: boolean }) {
  const completion = calculateProfileCompletion(profile)

  if (compact) {
    return (
      <Card className="border border-mist-100 p-4 lg:hidden">
        <div className="flex items-center gap-3">
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(145deg,var(--mist-100),white)] text-sm font-semibold text-navy-950 ring-1 ring-mist-100">
            {initials(profile.fullName)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-navy-950">{profile.fullName}</p>
            <p className="truncate text-sm text-muted">{profile.headline ?? profile.rank ?? 'Maritime professional'}</p>
          </div>
          <Link href="/profile" className="shrink-0 text-sm font-semibold text-ocean-700 hover:text-navy-950">
            Profile
          </Link>
        </div>
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden border border-mist-100">
      <div className="h-20 bg-[linear-gradient(115deg,var(--navy-950),var(--ocean-700)_58%,var(--teal-500))]" />
      <div className="px-5 pb-5 text-center">
        <div className="mx-auto -mt-9 grid size-18 place-items-center rounded-2xl border-4 border-white bg-mist-100 text-lg font-semibold text-navy-950 shadow-sm">
          {initials(profile.fullName)}
        </div>
        <p className="mt-3 text-lg font-semibold text-navy-950">{profile.fullName}</p>
        {profile.headline ? <p className="mt-1 text-sm leading-5 text-muted">{profile.headline}</p> : null}
        {profile.rank || profile.currentCompany ? (
          <p className="mt-2 flex items-center justify-center gap-1.5 text-xs font-medium text-ocean-700">
            <Anchor aria-hidden="true" className="size-3.5" />
            {[profile.rank, profile.currentCompany].filter(Boolean).join(' · ')}
          </p>
        ) : null}
      </div>

      <div className="border-t border-mist-100 px-5 py-4">
        <dl className="space-y-3 text-sm">
          {profile.sailingExperienceYears !== null ? (
            <div className="flex items-center justify-between gap-3">
              <dt className="flex items-center gap-2 text-muted"><Waves aria-hidden="true" className="size-4" />Sea service</dt>
              <dd className="font-semibold text-navy-950">{profile.sailingExperienceYears} years</dd>
            </div>
          ) : null}
          {profile.availability ? (
            <div className="flex items-start justify-between gap-3">
              <dt className="flex items-center gap-2 text-muted"><Clock3 aria-hidden="true" className="mt-0.5 size-4" />Availability</dt>
              <dd className="max-w-32 text-right font-semibold text-teal-500">{profile.availability}</dd>
            </div>
          ) : null}
          {profile.shoreCareerPreference ? (
            <div className="flex items-center justify-between gap-3">
              <dt className="flex items-center gap-2 text-muted"><BriefcaseBusiness aria-hidden="true" className="size-4" />Career</dt>
              <dd className="font-semibold text-ocean-700">Open to shore</dd>
            </div>
          ) : null}
          {profile.currentVessel ? (
            <div className="flex items-start justify-between gap-3">
              <dt className="flex items-center gap-2 text-muted"><Ship aria-hidden="true" className="mt-0.5 size-4" />Vessel</dt>
              <dd className="max-w-32 text-right font-semibold text-navy-950">{profile.currentVessel}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      <div className="border-t border-mist-100 px-5 py-4">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-muted">Profile completeness</span>
          <span className="font-semibold text-navy-950">{completion}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-mist-100" role="progressbar" aria-label="Profile completeness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completion}>
          <div className="h-full rounded-full bg-ocean-700" style={{ width: `${completion}%` }} />
        </div>
        <Link href="/profile" className="mt-4 flex min-h-10 items-center justify-center rounded-xl border border-mist-100 text-sm font-semibold text-navy-900 hover:border-ocean-500 hover:text-ocean-700">
          View profile
        </Link>
      </div>
    </Card>
  )
}
