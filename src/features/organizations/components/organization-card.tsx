import Link from 'next/link'
import type { ReactNode } from 'react'
import { BadgeCheck } from 'lucide-react'
import { followerLabel, organizationCoverUrl, organizationTagline } from '../organization-page-profile'
import type { OrganizationCard as OrganizationCardData } from '../workspace-repository'
import { OrganizationFollowButton } from './organization-follow-button'
import { OrganizationCover, OrganizationLogo } from './organization-logo'

export function VerifiedMark({ className = 'size-4' }: { className?: string }) {
  return (
    <BadgeCheck role="img" aria-label="Verified by Sea N Shore" className={`${className} shrink-0 text-emerald-700`} />
  )
}

/**
 * Organization card with cover, overlapping logo, name, type and followers.
 * Shows a Follow button unless `actions` replaces it (for example View page / Manage).
 */
export function OrganizationCard({
  organization,
  actions,
  meta,
}: {
  organization: OrganizationCardData
  actions?: ReactNode
  /** Extra line under the type, e.g. the viewer's role chips. */
  meta?: ReactNode
}) {
  const href = '/organizations/' + organization.slug
  const tagline = organizationTagline(organization)
  return (
    <article className="flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-mist-100 bg-white shadow-[var(--shadow-card)] transition hover:border-ocean-200">
      <OrganizationCover coverUrl={organizationCoverUrl(organization)} name={organization.name} className="h-16" />
      <div className="flex flex-1 flex-col px-4 pb-4">
        <OrganizationLogo company={organization} size="lg" className="relative -mt-8" />
        <div className="mt-2 min-w-0">
          <p className="flex min-w-0 items-center gap-1.5">
            <Link href={href} className="truncate font-bold text-navy-950 hover:text-ocean-700 hover:underline">{organization.name}</Link>
            {organization.verified ? <VerifiedMark /> : null}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted">
            {[organization.companyType, organization.headquarters].filter(Boolean).join(' · ')}
          </p>
          {tagline ? <p className="mt-1.5 line-clamp-2 text-sm leading-5 text-ink">{tagline}</p> : null}
          <p className="mt-1.5 text-xs font-semibold text-muted">{followerLabel(organization.followerCount)}</p>
          {meta ? <div className="mt-2 flex flex-wrap gap-1.5">{meta}</div> : null}
        </div>
        <div className="mt-auto pt-3">
          {actions ?? (
            <OrganizationFollowButton
              companyId={organization.id}
              initialFollowing={organization.following}
              initialFollowerCount={organization.followerCount}
              appearance="card"
              organizationName={organization.name}
            />
          )}
        </div>
      </div>
    </article>
  )
}

/** Compact row for the "Pages people also viewed" rail. */
export function OrganizationSuggestionRow({ organization }: { organization: OrganizationCardData }) {
  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <OrganizationLogo company={organization} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1">
          <Link href={'/organizations/' + organization.slug} className="truncate text-sm font-bold text-navy-950 hover:text-ocean-700 hover:underline">
            {organization.name}
          </Link>
          {organization.verified ? <VerifiedMark className="size-3.5" /> : null}
        </p>
        <p className="truncate text-xs text-muted">{organization.companyType}</p>
        <p className="text-xs text-muted">{followerLabel(organization.followerCount)}</p>
        <div className="mt-2 w-28">
          <OrganizationFollowButton
            companyId={organization.id}
            initialFollowing={organization.following}
            initialFollowerCount={organization.followerCount}
            appearance="card"
            organizationName={organization.name}
          />
        </div>
      </div>
    </li>
  )
}
