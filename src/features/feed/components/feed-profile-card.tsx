import { MediaImage } from '@/components/ui/media-image'
import Link from 'next/link'
import { Anchor, BadgeCheck, BookOpen, BriefcaseBusiness, GraduationCap, HeartHandshake, MapPin, Ship, Waves } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { OrganizationLogo } from '@/features/profiles/components/organization-logo'
import { organizationPageHref } from '@/features/profiles/organization-link'
import { PERSONA_LABELS, personaUsesProfessionalCompany } from '@/features/profiles/persona'
import type { OwnProfile } from '@/features/profiles/types'
import { calculateProfileCompletion, type ProfilePortfolioCompletion } from '../profile-completion'
import { formatYears } from '@/lib/format'

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

function textKey(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('en')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** True when `phrase` appears in `text` as whole words. */
function containsPhrase(text: string, phrase: string) {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(phrase)}($|[^\\p{L}\\p{N}])`, 'u').test(text)
}

type ProfileDetail = { text: string; icon: LucideIcon }

export type ProfileCardIdentity = {
  headline: string | null
  personaLabel: string | null
  detail: ProfileDetail | null
  organization:
    | { kind: 'linked'; name: string; href: string; logoUrl: string | null; verified: boolean }
    | { kind: 'text'; name: string }
    | null
}

function personaDetail(profile: OwnProfile): ProfileDetail | null {
  const value = (text: string | null | undefined, icon: LucideIcon) => (text?.trim() ? { text: text.trim(), icon } : null)
  switch (profile.persona) {
    case 'seafarer':
      return value(profile.rank, Anchor)
    case 'trainer_instructor':
      return value(profile.specialization, BookOpen)
    case 'student_cadet':
      return value(profile.institutionName, GraduationCap)
    case 'seafarer_family':
      return value(profile.communityRelationship, HeartHandshake)
    case undefined:
    case null:
      return value(profile.rank, Anchor)
    default:
      return null
  }
}

/**
 * What the Home profile card shows, with every piece of text appearing at most
 * once (case-insensitive): a default headline such as "Maritime Enthusiast" is
 * not repeated as the persona label or the descriptor.
 */
export function profileCardIdentity(profile: OwnProfile): ProfileCardIdentity {
  const seen = new Set<string>()
  let headlineKey = ''
  function distinct(value: string | null | undefined, options: { skipIfInHeadline?: boolean } = {}) {
    const text = value?.replace(/\s+/g, ' ').trim()
    if (!text) return null
    const key = textKey(text)
    if (seen.has(key)) return null
    // "Chief Officer" is already visible inside "Chief Officer · Tankers".
    if (options.skipIfInHeadline && headlineKey && containsPhrase(headlineKey, key)) return null
    seen.add(key)
    return text
  }

  const linked = profile.currentOrganization
  const companyName = linked?.name ?? profile.currentCompany?.trim() ?? null
  // The organization row owns the organization name, so no other line repeats it.
  if (companyName) seen.add(textKey(companyName))

  const headline = distinct(profile.headline)
  headlineKey = headline ? textKey(headline) : ''
  const personaLabel = distinct(profile.persona ? PERSONA_LABELS[profile.persona] : null, { skipIfInHeadline: true })
  const detailSource = personaDetail(profile)
  const detailText = distinct(detailSource?.text, { skipIfInHeadline: true })

  return {
    headline,
    personaLabel,
    detail: detailSource && detailText ? { ...detailSource, text: detailText } : null,
    organization: linked
      ? {
          kind: 'linked',
          name: linked.name,
          href: organizationPageHref(linked.slug),
          logoUrl: linked.logoUrl,
          verified: linked.verified,
        }
      : companyName
        ? { kind: 'text', name: companyName }
        : null,
  }
}

function VerifiedBadge({ className = 'size-4' }: { className?: string }) {
  return (
    <span title="Verified by Sea N Shore" className="inline-flex shrink-0 text-ocean-700">
      <BadgeCheck role="img" aria-label="Verified member" className={className} />
    </span>
  )
}

function OrganizationName({ organization, compact = false }: { organization: NonNullable<ProfileCardIdentity['organization']>; compact?: boolean }) {
  const logoUrl = organization.kind === 'linked' ? organization.logoUrl : null
  const content = (
    <>
      <OrganizationLogo logoUrl={logoUrl} size={compact ? 'xs' : 'sm'} />
      <span className={compact ? 'min-w-0 truncate' : 'min-w-0 line-clamp-2 leading-5'}>{organization.name}</span>
      {organization.kind === 'linked' && organization.verified ? (
        <BadgeCheck aria-label="Verified organization" className="size-3.5 shrink-0 text-ocean-700" />
      ) : null}
    </>
  )
  const layout = compact ? 'gap-1.5 text-xs' : 'gap-2.5 text-sm'

  if (organization.kind === 'linked') {
    return (
      <Link
        href={organization.href}
        data-testid="profile-card-organization"
        className={`flex min-w-0 items-center font-semibold text-ocean-700 hover:underline ${layout}`}
      >
        {content}
      </Link>
    )
  }
  return (
    <p data-testid="profile-card-organization" className={`flex min-w-0 items-center font-semibold text-navy-950 ${layout}`}>
      {content}
    </p>
  )
}

export function FeedProfileCard({
  profile,
  portfolioCompletion,
  verified = false,
  compact = false,
}: {
  profile: OwnProfile
  portfolioCompletion: ProfilePortfolioCompletion
  /** The member holds an approved Sea N Shore verification. */
  verified?: boolean
  compact?: boolean
}) {
  const completion = calculateProfileCompletion(profile, portfolioCompletion)
  const incomplete = completion < 100
  const isSeafarer = profile.persona === 'seafarer' || (!profile.persona && profile.profileType === 'seafarer')
  const identity = profileCardIdentity(profile)
  const usesCompany = profile.persona ? personaUsesProfessionalCompany(profile.persona) : profile.identityRoot !== 'organisation'

  if (compact) {
    const summary = identity.headline ?? identity.personaLabel ?? identity.detail?.text ?? 'Sea N Shore member'
    return (
      <Card className="border border-mist-100 p-4 lg:hidden">
        <div className="flex items-center gap-3">
          <Link href="/profile" aria-label={`${profile.fullName}, view profile`} className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-[linear-gradient(145deg,var(--mist-100),white)] text-sm font-semibold text-navy-950 ring-1 ring-mist-100 hover:ring-ocean-500">
            {profile.avatarUrl ? (
              <MediaImage src={profile.avatarUrl} alt={`${profile.fullName} profile photo`} fill sizes="48px" loading="eager" className="object-cover" fallback={initials(profile.fullName)} />
            ) : (
              initials(profile.fullName)
            )}
          </Link>
          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 items-center gap-1">
              <Link href="/profile" className="truncate font-semibold text-navy-950 hover:text-ocean-700 hover:underline">{profile.fullName}</Link>
              {verified ? <VerifiedBadge className="size-3.5" /> : null}
            </p>
            <p className="truncate text-sm text-muted">{summary}</p>
            {identity.organization ? (
              <div className="mt-0.5 flex min-w-0">
                <OrganizationName organization={identity.organization} compact />
              </div>
            ) : null}
          </div>
          {incomplete ? (
            <Link href="/profile/edit" className="inline-flex min-h-9 shrink-0 items-center rounded-xl border border-mist-200 px-3 text-sm font-semibold text-ocean-700 hover:border-ocean-500 hover:bg-ocean-50">
              Complete profile
            </Link>
          ) : null}
        </div>
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden border border-mist-100">
      <div className="relative h-16 overflow-hidden bg-[linear-gradient(115deg,var(--navy-950),var(--ocean-700)_58%,var(--teal-500))]">
        {profile.coverUrl ? (
          <MediaImage src={profile.coverUrl} alt={`${profile.fullName} cover photo`} fill sizes="320px" quality={90} loading="eager" className="object-cover" />
        ) : null}
      </div>
      <div className="px-4 pb-4 text-center">
        <Link
          href="/profile"
          aria-label={`${profile.fullName}, view profile`}
          className="relative mx-auto -mt-[37px] grid size-[74px] place-items-center overflow-hidden rounded-2xl border-4 border-white bg-mist-100 text-base font-semibold text-navy-950 shadow-sm hover:ring-2 hover:ring-ocean-500"
        >
          {profile.avatarUrl ? (
            <MediaImage src={profile.avatarUrl} alt={`${profile.fullName} profile photo`} fill sizes="74px" loading="eager" className="object-cover" fallback={initials(profile.fullName)} />
          ) : (
            initials(profile.fullName)
          )}
        </Link>
        <p className="mt-2 flex items-center justify-center gap-1">
          <Link href="/profile" className="min-w-0 text-base font-semibold text-navy-950 hover:text-ocean-700 hover:underline">
            {profile.fullName}
          </Link>
          {verified ? <VerifiedBadge /> : null}
        </p>
        {identity.headline ? <p className="mt-1 line-clamp-2 text-xs leading-4 text-ink">{identity.headline}</p> : null}
        {identity.personaLabel ? (
          <p className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-teal-700">{identity.personaLabel}</p>
        ) : null}
        {identity.detail ? (
          <p className="mt-1 flex items-center justify-center gap-1.5 text-xs font-medium text-navy-900">
            <identity.detail.icon aria-hidden="true" className="size-3.5 shrink-0 text-ocean-700" />
            <span className="min-w-0 truncate">{identity.detail.text}</span>
          </p>
        ) : null}
        {profile.location ? (
          <p className="mt-1 flex items-center justify-center gap-1 text-xs text-muted">
            <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{profile.location}</span>
          </p>
        ) : null}
        {!identity.headline && !identity.personaLabel && !identity.detail ? (
          <p className="mt-1 text-xs text-muted">Sea N Shore member</p>
        ) : null}
      </div>

      {identity.organization ? (
        <div className="border-t border-mist-100 px-4 py-3">
          <OrganizationName organization={identity.organization} />
        </div>
      ) : usesCompany ? (
        <div className="border-t border-mist-100 px-4 py-3">
          <Link href="/profile/edit#identity" className="flex items-center gap-2.5 text-sm font-semibold text-ocean-700 hover:underline">
            <OrganizationLogo logoUrl={null} size="sm" />
            Add your current organization
          </Link>
        </div>
      ) : null}

      {isSeafarer && (profile.sailingExperienceYears !== null || profile.shoreCareerPreference || profile.currentVessel) ? (
        <div className="border-t border-mist-100 px-4 py-3">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            {profile.sailingExperienceYears !== null ? (
              <div className="min-w-0">
                <dt className="flex items-center gap-1.5 text-muted"><Waves aria-hidden="true" className="size-3.5 shrink-0" />Sea service</dt>
                <dd className="mt-0.5 truncate font-semibold text-navy-950">{formatYears(profile.sailingExperienceYears)}</dd>
              </div>
            ) : null}
            {profile.shoreCareerPreference ? (
              <div className="min-w-0">
                <dt className="flex items-center gap-1.5 text-muted"><BriefcaseBusiness aria-hidden="true" className="size-3.5 shrink-0" />Career</dt>
                <dd className="mt-0.5 truncate font-semibold text-navy-950">Open to shore</dd>
              </div>
            ) : null}
            {profile.currentVessel ? (
              <div className="min-w-0">
                <dt className="flex items-center gap-1.5 text-muted"><Ship aria-hidden="true" className="size-3.5 shrink-0" />Vessel</dt>
                <dd className="mt-0.5 truncate font-semibold text-navy-950" title={profile.currentVessel}>{profile.currentVessel}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}

      {incomplete ? (
        <div className="border-t border-mist-100 px-4 py-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-muted">Profile completeness</span>
            <span className="font-semibold text-navy-950">{completion}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-mist-100" role="progressbar" aria-label="Profile completeness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completion}>
            <div className="h-full rounded-full bg-ocean-700" style={{ width: `${completion}%` }} />
          </div>
          <Link href="/profile/edit" className="mt-3 flex min-h-9 items-center justify-center rounded-xl border border-mist-200 text-sm font-semibold text-navy-900 hover:border-ocean-500 hover:bg-ocean-50 hover:text-ocean-700">
            Complete profile
          </Link>
        </div>
      ) : null}
    </Card>
  )
}
