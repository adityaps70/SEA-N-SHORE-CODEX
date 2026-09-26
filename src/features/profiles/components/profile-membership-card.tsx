import Link from 'next/link'
import { BadgeCheck, Building2, Compass, CreditCard, ShieldCheck } from 'lucide-react'
import type { AccessContext } from '@/features/access/policy'
import type { UserOrganizationMembershipSummary } from '@/features/organizations/repository'
import { PERSONA_LABELS, PROFILE_INTENT_LABELS } from '../persona'
import type { OwnProfile } from '../types'

const planLabel = (plan: AccessContext['personalPlan']) =>
  plan === 'creator_pro' ? 'Creator Pro' : 'Sea N Shore Member — FREE'

const verificationLabel = {
  recruiter: 'Verified Recruiter',
  trainer: 'Verified Trainer',
  event_host: 'Verified Event Host',
} as const

const roleLabel = (role: UserOrganizationMembershipSummary['role']) =>
  role.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())

function onboardingDetails(profile: OwnProfile) {
  const details: Array<{ label: string; value: string }> = []

  if (profile.persona === 'seafarer') {
    if (profile.rank) details.push({ label: 'Rank', value: profile.rank })
    if (profile.currentCompany) details.push({ label: 'Current organization', value: profile.currentCompany })
  } else if (
    profile.persona === 'shore_professional'
    || profile.persona === 'recruiter_hr'
    || profile.persona === 'trainer_instructor'
  ) {
    if (profile.currentCompany) details.push({ label: 'Current organization', value: profile.currentCompany })
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

export function ProfileMembershipCard({
  profile,
  access,
  organizations,
}: {
  profile: OwnProfile
  access: AccessContext
  organizations: UserOrganizationMembershipSummary[]
}) {
  const profileIntents = profile.profileIntents ?? []
  const details = onboardingDetails(profile)

  return (
    <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-ocean-700">Sea N Shore membership</p>
          <h2 className="mt-1 text-xl font-bold text-navy-950">Your profile, access & goals</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            Your persona personalizes the platform. Verification, paid plan and organization role separately control professional publishing.
          </p>
        </div>
        <Link href="/profile/edit" className="rounded-xl border border-mist-100 bg-white px-4 py-2 text-sm font-bold text-navy-950 hover:border-ocean-300">
          Edit profile & goals
        </Link>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <article className="rounded-2xl bg-mist-50/70 p-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-muted">
            <Compass aria-hidden="true" className="size-4 text-ocean-700" /> Profile type
          </div>
          <p className="mt-2 font-bold text-navy-950">
            {profile.persona ? PERSONA_LABELS[profile.persona] : 'Legacy profile'}
          </p>
          {details.length ? (
            <dl className="mt-3 space-y-2">
              {details.map((detail) => (
                <div key={detail.label}>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted">{detail.label}</dt>
                  <dd className="mt-0.5 text-sm font-semibold text-navy-950">{detail.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {profileIntents.map((intent) => (
              <span key={intent} className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-navy-900">
                {PROFILE_INTENT_LABELS[intent]}
              </span>
            ))}
            {!profileIntents.length ? <span className="text-xs text-muted">Add your goals from Edit Profile.</span> : null}
          </div>
        </article>

        <article className="rounded-2xl bg-mist-50/70 p-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-muted">
            <CreditCard aria-hidden="true" className="size-4 text-ocean-700" /> Personal plan
          </div>
          <p className="mt-2 font-bold text-navy-950">{planLabel(access.personalPlan)}</p>
          <Link href="/settings/billing" className="mt-3 inline-flex text-xs font-bold text-ocean-700 hover:underline">Membership & billing →</Link>
        </article>

        <article className="rounded-2xl bg-mist-50/70 p-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-muted">
            <BadgeCheck aria-hidden="true" className="size-4 text-ocean-700" /> Verifications
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {access.verifications.map((verification) => (
              <span key={verification} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">
                <ShieldCheck aria-hidden="true" className="size-3.5" /> {verificationLabel[verification]}
              </span>
            ))}
            {!access.verifications.length ? <span className="text-sm text-muted">No professional verification yet.</span> : null}
          </div>
          <Link href="/settings/verifications" className="mt-3 inline-flex text-xs font-bold text-ocean-700 hover:underline">Manage verifications →</Link>
        </article>
      </div>

      <div className="mt-4 rounded-2xl border border-mist-100 p-4">
        <div className="flex items-center gap-2">
          <Building2 aria-hidden="true" className="size-4 text-ocean-700" />
          <h3 className="font-bold text-navy-950">Organization memberships</h3>
        </div>
        {organizations.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {organizations.map((organization) => (
              <Link
                key={organization.id}
                href={'/organizations/' + organization.slug}
                className="rounded-full bg-mist-50 px-3 py-1.5 text-xs font-semibold text-navy-900 transition hover:bg-ocean-50 hover:text-ocean-800"
              >
                {organization.name} · {roleLabel(organization.role)}{organization.verified ? ' · Verified' : ''}
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">You are not yet linked to an organization workspace.</p>
        )}
        <Link href="/organizations" className="mt-3 inline-flex text-xs font-bold text-ocean-700 hover:underline">Create, claim or manage organizations →</Link>
      </div>
    </section>
  )
}
