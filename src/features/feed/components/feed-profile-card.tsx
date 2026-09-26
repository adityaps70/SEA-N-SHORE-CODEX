/* eslint-disable @next/next/no-img-element */
import Link from 'next/link'
import { Anchor, BriefcaseBusiness, Clock3, Ship, Waves } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { PERSONA_LABELS } from '@/features/profiles/persona'
import type { OwnProfile } from '@/features/profiles/types'
import { calculateProfileCompletion, type ProfilePortfolioCompletion } from '../profile-completion'

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

function profileDescriptor(profile: OwnProfile) {
  if (profile.persona === 'seafarer_family') return profile.communityRelationship ?? PERSONA_LABELS.seafarer_family
  if (profile.persona === 'student_cadet') return profile.institutionName ?? PERSONA_LABELS.student_cadet
  if (profile.persona === 'trainer_instructor') return profile.specialization ?? profile.currentCompany ?? PERSONA_LABELS.trainer_instructor
  if (profile.persona === 'shore_professional' || profile.persona === 'recruiter_hr') {
    return profile.currentCompany ?? PERSONA_LABELS[profile.persona]
  }
  if (profile.persona === 'seafarer') {
    return [profile.rank, profile.currentCompany].filter(Boolean).join(' · ') || PERSONA_LABELS.seafarer
  }
  if (profile.persona) return PERSONA_LABELS[profile.persona]
  return [profile.rank, profile.currentCompany].filter(Boolean).join(' · ') || null
}

export function FeedProfileCard({
  profile,
  portfolioCompletion,
  compact = false,
}: {
  profile: OwnProfile
  portfolioCompletion: ProfilePortfolioCompletion
  compact?: boolean
}) {
  const completion = calculateProfileCompletion(profile, portfolioCompletion)
  const isSeafarer = profile.persona === 'seafarer' || (!profile.persona && profile.profileType === 'seafarer')
  const descriptor = profileDescriptor(profile)
  const profileAction = completion < 100
    ? { href: '/profile/edit', label: 'Complete profile' }
    : { href: '/profile', label: 'View profile' }

  if (compact) {
    return (
      <Card className="border border-mist-100 p-4 lg:hidden">
        <div className="flex items-center gap-3">
          <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-[linear-gradient(145deg,var(--mist-100),white)] text-sm font-semibold text-navy-950 ring-1 ring-mist-100">
            {profile.avatarUrl ? (
              <img src={profile.avatarUrl} alt={`${profile.fullName} profile photo`} className="h-full w-full object-cover" />
            ) : (
              initials(profile.fullName)
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-navy-950">{profile.fullName}</p>
            <p className="truncate text-sm text-muted">{profile.headline ?? descriptor ?? 'Sea N Shore member'}</p>
          </div>
          <Link href={profileAction.href} className="shrink-0 text-sm font-semibold text-ocean-700 hover:text-navy-950">
            {profileAction.label}
          </Link>
        </div>
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden border border-mist-100">
      <div className="h-16 overflow-hidden bg-[linear-gradient(115deg,var(--navy-950),var(--ocean-700)_58%,var(--teal-500))]">
        {profile.coverUrl ? (
          <img src={profile.coverUrl} alt={`${profile.fullName} cover photo`} className="h-full w-full object-cover" />
        ) : null}
      </div>
      <div className="px-4 pb-4 text-center">
        <div className="mx-auto -mt-[37px] grid size-[74px] place-items-center overflow-hidden rounded-2xl border-4 border-white bg-mist-100 text-base font-semibold text-navy-950 shadow-sm">
          {profile.avatarUrl ? (
            <img src={profile.avatarUrl} alt={`${profile.fullName} profile photo`} className="h-full w-full object-cover" />
          ) : (
            initials(profile.fullName)
          )}
        </div>
        <p className="mt-2 text-base font-semibold text-navy-950">{profile.fullName}</p>
        {profile.headline ? <p className="mt-1 line-clamp-2 text-xs leading-4 text-muted">{profile.headline}</p> : null}
        {profile.persona ? (
          <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.1em] text-teal-700">
            {PERSONA_LABELS[profile.persona]}
          </p>
        ) : null}
        {descriptor ? (
          <p className="mt-1.5 flex items-center justify-center gap-1.5 text-xs font-medium text-ocean-700">
            {isSeafarer ? <Anchor aria-hidden="true" className="size-3.5" /> : <BriefcaseBusiness aria-hidden="true" className="size-3.5" />}
            {descriptor}
          </p>
        ) : null}
      </div>

      {isSeafarer ? (
      <div className="border-t border-mist-100 px-4 py-3">
        <dl className="space-y-2 text-sm">
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
      ) : null}

      <div className="border-t border-mist-100 px-4 py-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-muted">Profile completeness</span>
          <span className="font-semibold text-navy-950">{completion}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-mist-100" role="progressbar" aria-label="Profile completeness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completion}>
          <div className="h-full rounded-full bg-ocean-700" style={{ width: `${completion}%` }} />
        </div>
        <Link href={profileAction.href} className="mt-3 flex min-h-9 items-center justify-center rounded-xl border border-mist-100 text-sm font-semibold text-navy-900 hover:border-ocean-500 hover:text-ocean-700">
          {profileAction.label}
        </Link>
      </div>
    </Card>
  )
}
