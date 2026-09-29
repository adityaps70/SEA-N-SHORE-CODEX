import Link from 'next/link'
import { Pencil } from 'lucide-react'
import { accessRoleLabel } from '@/features/organizations/access-request-labels'
import { organizationPageHref } from '../organization-link'
import type { ProfileOrganization } from '../organization-link-repository'
import { OrganizationLogo } from './organization-logo'
import { OrganizationStatusBadge } from './organization-status-badge'
import { ProfileSection, profileFieldLabelClass } from './profile-section'
import { PhoneShowAll } from './profile-show-all'

function OrganizationRow({ organization }: { organization: ProfileOrganization }) {
  const meta = [organization.type, organization.location].filter(Boolean).join(' · ')
  return (
    <Link
      href={organizationPageHref(organization.slug)}
      className="group flex min-w-0 items-center gap-3 rounded-2xl border border-mist-200 bg-white p-3 transition hover:border-ocean-200 hover:bg-ocean-50/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-600"
    >
      <OrganizationLogo logoUrl={organization.logoUrl} size="md" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate text-sm font-semibold text-navy-950 group-hover:text-ocean-700 group-hover:underline">{organization.name}</span>
          <OrganizationStatusBadge organization={organization} size="sm" />
        </span>
        <span className="mt-0.5 block text-sm text-ink">{accessRoleLabel(organization.role)}</span>
        {meta ? <span className="block truncate text-xs text-muted">{meta}</span> : null}
      </span>
    </Link>
  )
}

function OrganizationGroup({ id, label, organizations }: { id: string; label: string; organizations: ProfileOrganization[] }) {
  if (!organizations.length) return null
  return (
    <div className="mt-5 first-of-type:mt-4">
      <h3 id={id} className={profileFieldLabelClass}>{label}</h3>
      <PhoneShowAll as="ul" itemAs="li" itemClassName="min-w-0" labelledBy={id} noun="organizations" placement="inline" className="mt-2 grid gap-2 sm:grid-cols-2">
        {organizations.map((organization) => <OrganizationRow key={organization.id} organization={organization} />)}
      </PhoneShowAll>
    </div>
  )
}

/**
 * The Organizations section of a profile: pages the member owns or manages, and
 * organizations they work for. Only approved memberships of organizations that
 * Sea N Shore lists, the same people each organization's People tab shows.
 */
export function ProfileOrganizations({
  organizations,
  editable = false,
}: {
  organizations: ProfileOrganization[]
  /** The member's own profile: show an empty state and a link to manage organizations. */
  editable?: boolean
}) {
  if (!editable && !organizations.length) return null
  const manages = organizations.filter((organization) => organization.relation === 'manages')
  const worksAt = organizations.filter((organization) => organization.relation === 'works_at')

  return (
    <ProfileSection
      id="profile-organizations"
      title="Organizations"
      action={editable ? (
        <Link href="/organizations" aria-label="Manage organizations" className="inline-flex min-h-10 items-center rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-950 transition-colors hover:border-ocean-300 hover:bg-mist-50 max-md:size-11 max-md:min-h-0 max-md:justify-center max-md:rounded-full max-md:border-transparent max-md:px-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-600">
          <Pencil aria-hidden="true" className="size-5 md:hidden" />
          <span className="max-md:sr-only">Manage organizations</span>
        </Link>
      ) : null}
    >
      {organizations.length ? (
        <>
          <OrganizationGroup id="profile-organizations-manages" label="Owns or manages" organizations={manages} />
          <OrganizationGroup id="profile-organizations-works-at" label="Works at" organizations={worksAt} />
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">
          You are not part of an organization on Sea N Shore yet. Find the one you work with and ask to join, or register the organization you run.
        </p>
      )}
    </ProfileSection>
  )
}
