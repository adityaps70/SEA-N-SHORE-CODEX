import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, BadgeCheck, Building2, UsersRound } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { primaryButtonClass, secondaryButtonClass } from '@/components/ui/interactive-styles'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { ORGANIZATION_PRO_CHOOSER_HREF } from '@/features/billing/organization-pro-path'
import { CreateCommunityForm, type CreateCommunityIdentity } from '@/features/community/components/create-community-form'
import { CREATE_AS_SELF, ELIGIBILITY_REASON_TEXT, isOrganizationCreatorRole } from '@/features/community/eligibility'
import { getCommunityCreationEligibility, type CommunityCreationOrganization } from '@/features/community/eligibility-server'
import { organizationPlanBillingHref } from '@/features/organizations/organization-page-profile'

export const metadata: Metadata = { title: 'Create a community' }

const PLANS_HREF = '/plans'

function single(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) ?? ''
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl py-2 sm:py-4 max-md:py-0">
      <MobilePageBar backHref="/community" title="Create a community" />
      <header className="mb-4 max-md:sr-only">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-800">Professional Communities</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-navy-950">Create a community</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
          A focused space for one topic, rank or trade. You own it, appoint moderators and decide how members join.
        </p>
      </header>
      {children}
    </div>
  )
}

function Card({ children, labelledBy }: { children: React.ReactNode; labelledBy: string }) {
  return (
    <section aria-labelledby={labelledBy} className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6 max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:shadow-none">
      {children}
    </section>
  )
}

/** Where an organization's owner or administrator buys Organization Pro. */
function organizationUpgradeHref(organization: Pick<CommunityCreationOrganization, 'slug' | 'role'>) {
  return isOrganizationCreatorRole(organization.role) ? organizationPlanBillingHref(organization.slug) : ORGANIZATION_PRO_CHOOSER_HREF
}

function OrganizationBlocked({ organization, canCreateOtherwise }: { organization: CommunityCreationOrganization; canCreateOtherwise: boolean }) {
  const reason = organization.reason
  return (
    <Card labelledBy="community-blocked-heading">
      <Building2 aria-hidden="true" className="size-8 text-ocean-700" />
      <h2 id="community-blocked-heading" className="mt-3 text-xl font-bold text-navy-950">
        {reason === 'limit_reached' ? `${organization.name} already runs a community` : reason === 'not_admin' ? `Only an owner or administrator can create for ${organization.name}` : `${organization.name} needs Organization Pro to create a community`}
      </h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
        {reason === 'limit_reached'
          ? ELIGIBILITY_REASON_TEXT.limit_reached
          : reason === 'not_admin'
            ? ELIGIBILITY_REASON_TEXT.not_admin
            : `Creating a community for an organization is part of Organization Pro. Once ${organization.name} is verified and on Organization Pro, its owner and administrators can create one community here.`}
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        {reason === 'organization_pro_required' ? (
          <Link href={organizationUpgradeHref(organization)} className={primaryButtonClass}>
            Get Organization Pro <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        ) : null}
        <Link href={`/organizations/${organization.slug}`} className={secondaryButtonClass}>Back to {organization.name}</Link>
        {canCreateOtherwise ? <Link href="/community/new" className={secondaryButtonClass}>Create as yourself instead</Link> : null}
      </div>
    </Card>
  )
}

function NotEligible({ personalReason, organizations }: { personalReason: 'creator_pro_required' | 'limit_reached' | null; organizations: CommunityCreationOrganization[] }) {
  const proCandidates = organizations.filter((organization) => organization.reason === 'organization_pro_required' && isOrganizationCreatorRole(organization.role))
  const organizationHref = proCandidates.length === 1 ? organizationPlanBillingHref(proCandidates[0].slug) : proCandidates.length > 1 ? ORGANIZATION_PRO_CHOOSER_HREF : null
  const reasons = [
    personalReason ? ELIGIBILITY_REASON_TEXT[personalReason] : null,
    ...organizations.map((organization) => organization.reason === 'limit_reached'
      ? `${organization.name} already runs its community.`
      : organization.reason === 'not_admin'
        ? `Only an owner or administrator of ${organization.name} can create its community.`
        : organization.reason === 'organization_pro_required'
          ? `${organization.name} is not on Organization Pro${organization.role === 'owner' || organization.role === 'administrator' ? '' : ' (its owner or an administrator would create the community)'}.`
          : null),
  ].filter((reason): reason is string => Boolean(reason))

  return (
    <Card labelledBy="community-plan-heading">
      <UsersRound aria-hidden="true" className="size-8 text-ocean-700" />
      <h2 id="community-plan-heading" className="mt-3 text-xl font-bold text-navy-950">Creating a community is part of Creator Pro and Organization Pro</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
        Creator Pro members can run one community of their own, and each verified organization on Organization Pro can run one community. Here is why you cannot create one right now:
      </p>
      <ul aria-label="Why you cannot create a community right now" className="mt-3 space-y-1.5 text-sm text-navy-950">
        {[...new Set(reasons)].map((reason) => (
          <li key={reason} className="flex items-start gap-2"><BadgeCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted" />{reason}</li>
        ))}
      </ul>
      <div className="mt-5 flex flex-wrap gap-2">
        {personalReason === 'creator_pro_required' ? (
          <Link href={PLANS_HREF} className={primaryButtonClass}>See plans <ArrowRight aria-hidden="true" className="size-4" /></Link>
        ) : (
          <Link href={PLANS_HREF} className={secondaryButtonClass}>See plans</Link>
        )}
        {organizationHref ? <Link href={organizationHref} className={secondaryButtonClass}>Get Organization Pro</Link> : null}
        <Link href="/community" className={secondaryButtonClass}>Browse communities</Link>
      </div>
    </Card>
  )
}

export default async function CreateCommunityPage({ searchParams }: { searchParams?: Promise<{ as?: string | string[] }> }) {
  const user = await requireAwsUser()
  const requestedAs = single((await searchParams)?.as).trim()
  const options = await getCommunityCreationEligibility(user.id)
  const { eligibility, organizations } = options

  const requestedOrganization = requestedAs && requestedAs !== CREATE_AS_SELF ? organizations.find((organization) => organization.id === requestedAs) ?? null : null
  if (requestedOrganization && !requestedOrganization.allowed) {
    return <Shell><OrganizationBlocked organization={requestedOrganization} canCreateOtherwise={eligibility.canCreate} /></Shell>
  }

  if (!eligibility.canCreate) {
    return <Shell><NotEligible personalReason={eligibility.asMember.reason} organizations={organizations} /></Shell>
  }

  const identities: CreateCommunityIdentity[] = [
    ...(eligibility.asMember.allowed ? [{ value: CREATE_AS_SELF, label: 'Yourself', hint: options.isPlatformAdmin ? 'Sea N Shore administrator' : 'Creator Pro' }] : []),
    ...organizations.filter((organization) => organization.allowed).map((organization) => ({ value: organization.id, label: organization.name, hint: 'Organization Pro' })),
  ]

  return (
    <Shell>
      <Card labelledBy="community-form-heading">
        <h2 id="community-form-heading" className="sr-only">Community details</h2>
        <CreateCommunityForm identities={identities} initialAs={requestedOrganization?.id ?? null} />
      </Card>
    </Shell>
  )
}
