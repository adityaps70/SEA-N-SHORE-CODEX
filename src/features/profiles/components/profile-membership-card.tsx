import Link from 'next/link'
import type { ReactNode } from 'react'
import { BadgeCheck, CreditCard, ShieldCheck, type LucideIcon } from 'lucide-react'
import type { AccessContext } from '@/features/access/policy'
import { PERSONA_LABELS, PROFILE_INTENT_LABELS } from '../persona'
import { profileIdentityIcon } from '../persona-icons'
import type { OwnProfile } from '../types'
import { OrganizationStatusBadge } from './organization-status-badge'
import { ProfileField, ProfileFieldList, ProfileSection, profileSubheadingClass } from './profile-section'

const planLabel = (plan: AccessContext['personalPlan']) =>
  plan === 'creator_pro' ? 'Creator Pro' : 'Sea N Shore Member — FREE'

const verificationLabel = {
  recruiter: 'Verified Recruiter',
  trainer: 'Verified Trainer',
  event_host: 'Verified Event Host',
} as const

type Detail = { label: string; value: ReactNode }

function currentOrganization(profile: OwnProfile): ReactNode | null {
  const linked = profile.currentOrganization
  if (linked) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Link href={`/organizations/${linked.slug}`} className="font-semibold text-ocean-700 hover:underline">{linked.name}</Link>
        <OrganizationStatusBadge organization={linked} size="sm" />
      </span>
    )
  }
  return profile.currentCompany ?? null
}

function onboardingDetails(profile: OwnProfile) {
  const details: Detail[] = []
  const organization = currentOrganization(profile)

  if (profile.persona === 'seafarer') {
    if (profile.rank) details.push({ label: 'Rank', value: profile.rank })
    if (organization) details.push({ label: 'Current organization', value: organization })
  } else if (
    profile.persona === 'shore_professional'
    || profile.persona === 'recruiter_hr'
    || profile.persona === 'trainer_instructor'
  ) {
    if (organization) details.push({ label: 'Current organization', value: organization })
  }

  if (profile.persona === 'trainer_instructor' && profile.specialization) {
    details.push({ label: 'Specialization', value: profile.specialization })
  }
  if (profile.persona === 'student_cadet' && profile.institutionName) {
    details.push({ label: 'Institute / academy', value: profile.institutionName })
  }
  if (profile.persona === 'seafarer_family' && profile.communityRelationship) {
    details.push({ label: 'Relationship', value: profile.communityRelationship })
  }

  return details
}

function Panel({ id, title, icon: Icon, children }: { id: string; title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <article aria-labelledby={id} className="min-w-0 rounded-2xl border border-mist-100 bg-mist-50/60 p-4">
      <h3 id={id} className={`${profileSubheadingClass} flex items-center gap-2`}>
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white text-ocean-700 shadow-sm">
          <Icon aria-hidden="true" className="size-4" />
        </span>
        {title}
      </h3>
      <div className="mt-3">{children}</div>
    </article>
  )
}

const panelLinkClass = 'mt-4 inline-flex text-sm font-semibold text-ocean-700 hover:underline'

/**
 * "Access & goals" on the member's own profile: who they are on Sea N Shore and
 * what they came to do, their personal plan and their verifications.
 * Organizations have their own section.
 */
export function ProfileMembershipCard({
  profile,
  access,
}: {
  profile: OwnProfile
  access: AccessContext
}) {
  const profileIntents = profile.profileIntents ?? []
  const details = onboardingDetails(profile)
  const IdentityIcon = profileIdentityIcon(profile)

  return (
    <ProfileSection
      id="profile-access"
      title="Access & goals"
      description="Your profile type personalizes Sea N Shore. Publishing is unlocked separately by verification, your plan and your organization roles."
      action={(
        <Link href="/profile/edit" className="inline-flex min-h-10 items-center rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-950 transition-colors hover:border-ocean-300 hover:bg-mist-50">
          Edit profile & goals
        </Link>
      )}
    >
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <Panel id="profile-access-identity" title="Profile" icon={IdentityIcon}>
          <ProfileFieldList columns={1}>
            <ProfileField label="Profile type">{profile.persona ? PERSONA_LABELS[profile.persona] : 'Legacy profile'}</ProfileField>
            {details.map((detail) => <ProfileField key={detail.label} label={detail.label}>{detail.value}</ProfileField>)}
            <ProfileField label="Goals">
              {profileIntents.length ? (
                <span className="mt-0.5 flex flex-wrap gap-1.5">
                  {profileIntents.map((intent) => (
                    <span key={intent} className="rounded-full border border-mist-100 bg-white px-2.5 py-1 text-xs font-semibold text-navy-900">
                      {PROFILE_INTENT_LABELS[intent]}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="text-muted">Add what you want to do on Sea N Shore from Edit profile.</span>
              )}
            </ProfileField>
          </ProfileFieldList>
        </Panel>

        <Panel id="profile-access-plan" title="Plan" icon={CreditCard}>
          <ProfileFieldList columns={1}>
            <ProfileField label="Personal plan">{planLabel(access.personalPlan)}</ProfileField>
          </ProfileFieldList>
          <Link href="/settings/billing" className={panelLinkClass}>Membership & billing</Link>
        </Panel>

        <Panel id="profile-access-verifications" title="Verifications" icon={BadgeCheck}>
          {access.verifications.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {access.verifications.map((verification) => (
                <li key={verification} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                  <ShieldCheck aria-hidden="true" className="size-3.5" /> {verificationLabel[verification]}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink">No professional verification yet.</p>
          )}
          <Link href="/settings/verifications" className={panelLinkClass}>Manage verifications</Link>
        </Panel>
      </div>
    </ProfileSection>
  )
}
