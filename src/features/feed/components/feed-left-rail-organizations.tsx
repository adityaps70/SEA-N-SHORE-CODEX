import Link from 'next/link'
import { BadgeCheck, Plus } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { accessRoleLabel } from '@/features/organizations/access-request-labels'
import { organizationPlanBillingHref } from '@/features/organizations/organization-page-profile'
import { OrganizationLogo } from '@/features/profiles/components/organization-logo'
import type { HomeOrganizationShortcut, HomeOrganizationShortcuts } from '@/features/profiles/home-rail-queries'
import { createOrganizationHref, organizationPageHref } from '@/features/profiles/organization-link'

/** Keeps the sticky left rail short; the rest are one click away on Organizations. */
const MAX_VISIBLE_ORGANIZATIONS = 3

const linkClass = 'inline-flex min-h-6 cursor-pointer items-center font-semibold text-ocean-700 hover:text-navy-950 hover:underline'

function ProBadge() {
  return <span className="inline-flex shrink-0 items-center rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-bold text-teal-800">Organization Pro</span>
}

/** "Free plan · Upgrade" (owner/administrator of a verified organization) or the Pro badge. */
function PlanLine({ organization }: { organization: HomeOrganizationShortcut }) {
  if (organization.plan === 'organization_pro') return <ProBadge />
  return (
    <>
      <span aria-hidden="true" className="text-mist-200">·</span>
      <span>Free plan</span>
      {organization.canUpgrade ? (
        <>
          <span aria-hidden="true" className="text-mist-200">·</span>
          <Link href={organizationPlanBillingHref(organization.slug)} className={linkClass} aria-label={`Upgrade ${organization.name} to Organization Pro`}>
            Upgrade
          </Link>
        </>
      ) : null}
    </>
  )
}

/** One-card version for phones, where the left rail is hidden: at most three short rows. */
function CompactOrganizations({ organizations }: { organizations: HomeOrganizationShortcuts }) {
  const visible = organizations.memberships.slice(0, MAX_VISIBLE_ORGANIZATIONS)
  return (
    <Card className="border border-mist-100 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="home-your-organizations-compact" className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Your organizations</h2>
        <Link href="/organizations#your-pages" className="text-xs font-semibold text-ocean-700 hover:underline">
          {organizations.memberships.length > MAX_VISIBLE_ORGANIZATIONS ? `See all ${organizations.memberships.length}` : 'All organizations'}
        </Link>
      </div>
      {visible.length ? (
        <ul aria-labelledby="home-your-organizations-compact" className="mt-2 divide-y divide-mist-100">
          {visible.map((organization) => (
            <li key={organization.id} className="flex min-h-11 items-center gap-2.5 py-1.5">
              <OrganizationLogo logoUrl={organization.logoUrl} size="sm" />
              <div className="min-w-0 flex-1">
                <Link href={organizationPageHref(organization.slug)} className="block truncate text-sm font-semibold text-navy-950 hover:text-ocean-700 hover:underline" title={organization.name}>
                  {organization.name}
                </Link>
                <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted">
                  <span>{accessRoleLabel(organization.role)}</span>
                  <PlanLine organization={organization} />
                </p>
              </div>
              {organization.role !== 'member' ? (
                <Link
                  href={`${organizationPageHref(organization.slug)}/manage`}
                  className="inline-flex min-h-9 shrink-0 cursor-pointer items-center rounded-lg border border-mist-200 bg-white px-3 text-xs font-bold text-navy-950 transition hover:border-ocean-300 hover:bg-ocean-50"
                >
                  Manage<span className="sr-only">: {organization.name}</span>
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {organizations.application ? (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted">
          <span className="truncate font-semibold text-navy-950">{organizations.application.companyName}</span>
          <span>{organizations.application.statusLabel}</span>
          <Link href={organizations.application.href} className="font-semibold text-ocean-700 hover:underline">{organizations.application.linkLabel}</Link>
        </p>
      ) : null}
    </Card>
  )
}

/**
 * Home shortcuts to the member's organization pages, their settings and their plan.
 * `compact` is the small card shown under the profile card on phones; it renders nothing
 * when there is nothing to show.
 */
export function FeedLeftRailOrganizations({ organizations, compact = false }: { organizations: HomeOrganizationShortcuts | null; compact?: boolean }) {
  if (compact) {
    if (!organizations || (!organizations.memberships.length && !organizations.application)) return null
    return <CompactOrganizations organizations={organizations} />
  }

  return (
    <Card className="border border-mist-100 p-3">
      <h2 id="home-your-organizations" className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Your organizations</h2>

      {organizations === null ? (
        <p className="mt-2 text-sm leading-5 text-muted">
          We could not load your organizations just now.{' '}
          <Link href="/organizations" className="font-semibold text-ocean-700 hover:underline">Open Organizations</Link>
        </p>
      ) : (
        <>
          {organizations.memberships.length ? (
            <ul aria-labelledby="home-your-organizations" className="mt-2 space-y-2">
              {organizations.memberships.slice(0, MAX_VISIBLE_ORGANIZATIONS).map((organization) => (
                <li key={organization.id} className="flex items-center gap-2.5">
                  <OrganizationLogo logoUrl={organization.logoUrl} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 items-center gap-1 text-sm font-semibold text-navy-950">
                      <span className="truncate" title={organization.name}>{organization.name}</span>
                      {organization.verified ? <BadgeCheck aria-label="Verified organization" className="size-3.5 shrink-0 text-ocean-700" /> : null}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted">
                      <span>{accessRoleLabel(organization.role)}</span>
                      <PlanLine organization={organization} />
                    </p>
                    <p className="flex flex-wrap items-center gap-x-1.5 text-xs">
                      <Link href={organizationPageHref(organization.slug)} className={linkClass}>
                        View page<span className="sr-only">: {organization.name}</span>
                      </Link>
                      {organization.role !== 'member' ? (
                        <>
                          <span aria-hidden="true" className="text-mist-200">·</span>
                          <Link href={`${organizationPageHref(organization.slug)}/manage`} className={linkClass}>
                            Manage<span className="sr-only">: {organization.name}</span>
                          </Link>
                        </>
                      ) : null}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {organizations.memberships.length > MAX_VISIBLE_ORGANIZATIONS ? (
            <Link href="/organizations#your-organizations" className="mt-2.5 inline-flex text-xs font-semibold text-ocean-700 hover:underline">
              See all {organizations.memberships.length} organizations
            </Link>
          ) : null}

          {organizations.application ? (
            <div className="mt-2 flex items-start gap-2.5 rounded-lg bg-mist-50 p-2">
              <OrganizationLogo logoUrl={null} size="md" className="bg-white" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-navy-950">{organizations.application.companyName}</p>
                <p className={organizations.application.status === 'pending' ? 'text-xs text-muted' : 'text-xs font-medium text-amber-800'}>
                  {organizations.application.statusLabel}
                </p>
                <Link href={organizations.application.href} className="mt-1 inline-flex text-xs font-semibold text-ocean-700 hover:underline">
                  {organizations.application.linkLabel}
                </Link>
              </div>
            </div>
          ) : null}

          {!organizations.memberships.length && !organizations.application ? (
            <div className="mt-1.5">
              <p className="text-sm leading-5 text-muted">You are not part of an organization page yet.</p>
              <Link href={createOrganizationHref()} className="mt-1.5 inline-flex items-center gap-1 text-sm font-semibold text-ocean-700 hover:underline">
                <Plus aria-hidden="true" className="size-4" />
                Create an organization page
              </Link>
            </div>
          ) : null}
        </>
      )}
    </Card>
  )
}
