import Link from 'next/link'
import { Building2, Clock3 } from 'lucide-react'
import {
  CREATE_ORGANIZATION_HREF,
  organizationCheckoutHref,
  type OrganizationProCandidate,
  type OrganizationProPath,
} from '../organization-pro-path'

const primaryButton = 'inline-flex min-h-10 w-full cursor-pointer items-center justify-center rounded-xl bg-teal-600 px-4 text-sm font-bold text-white transition hover:bg-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 sm:w-auto'
const secondaryButton = 'inline-flex min-h-10 w-full cursor-pointer items-center justify-center rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-950 transition hover:border-ocean-300 hover:bg-ocean-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 sm:w-auto'
const textLink = 'font-bold text-ocean-700 hover:text-navy-950 hover:underline'

function roleLabel(role: OrganizationProCandidate['role']) {
  return role === 'owner' ? 'Owner' : 'Administrator'
}

function CandidateRow({ organization }: { organization: OrganizationProCandidate }) {
  const pro = organization.plan === 'organization_pro'
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-mist-200 bg-mist-50/50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="break-words font-semibold text-navy-950">{organization.name}</p>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <span>{roleLabel(organization.role)}</span>
          <span aria-hidden="true">·</span>
          <span className={`rounded-full px-2 py-0.5 font-bold ${pro ? 'bg-teal-50 text-teal-800' : 'bg-mist-100 text-navy-800'}`}>
            {pro ? 'Organization Pro' : 'Free plan'}
          </span>
          {organization.verified ? null : <span className="rounded-full bg-amber-50 px-2 py-0.5 font-bold text-amber-900">Not verified yet</span>}
        </p>
      </div>
      {!organization.verified ? (
        <p className="text-sm leading-5 text-muted sm:max-w-56 sm:text-right">
          Available once Sea N Shore verifies it.{' '}
          <Link href="/organizations#your-pages" className={textLink}>Check status</Link>
        </p>
      ) : pro ? (
        <Link href={`/settings/billing/organizations/${organization.id}`} className={secondaryButton} aria-label={`Manage the Organization Pro plan of ${organization.name}`}>
          Manage plan
        </Link>
      ) : (
        <Link href={organizationCheckoutHref(organization.id)} className={primaryButton} aria-label={`Upgrade ${organization.name} to Organization Pro`}>
          Upgrade to Organization Pro
        </Link>
      )}
    </li>
  )
}

function Explanation({ path }: { path: OrganizationProPath | null }) {
  if (!path) {
    return (
      <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
        We couldn’t load your organizations just now. Reload the page, or open{' '}
        <Link href="/organizations#your-pages" className="font-bold underline">Organizations</Link> and choose Manage on your organization.
      </p>
    )
  }
  switch (path.kind) {
    case 'restricted':
      return <p className="text-sm leading-6 text-muted">Your account is restricted right now, so plans can’t be bought. Contact the Sea N Shore team for help.</p>
    case 'unverified':
      return (
        <div className="flex gap-3 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sky-950">
          <Clock3 aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0">
            <p className="font-bold">
              {path.status === 'suspended' ? `${path.organizationName} is suspended` : `${path.organizationName} isn’t verified yet`}
            </p>
            <p className="mt-1 text-sm leading-6">
              {path.status === 'suspended'
                ? 'Organization Pro can be bought again once Sea N Shore resolves the review.'
                : 'Organization Pro becomes available as soon as Sea N Shore verifies your organization, because its features only work for verified organizations. Nothing is charged before then.'}
            </p>
            <Link href={path.statusHref} className="mt-3 inline-flex min-h-10 items-center rounded-xl bg-navy-950 px-4 text-sm font-bold text-white transition hover:bg-navy-900">
              {path.status === 'changes_requested' || path.status === 'rejected' ? 'Update your application' : 'View verification status'}
            </Link>
          </div>
        </div>
      )
    case 'member_only':
      return (
        <div className="text-sm leading-6 text-muted">
          <p>
            Only an organization’s owner or administrators can buy Organization Pro. Ask an owner or administrator of {path.organizationNames.join(', ')} to upgrade it.
          </p>
          <Link href="/organizations#your-pages" className={`mt-2 inline-flex ${textLink}`}>See your organizations →</Link>
        </div>
      )
    case 'none':
      return (
        <div className="text-sm leading-6 text-muted">
          <p>
            Organization Pro is bought for an organization page. Create your organization’s page first (it’s free). Once Sea N Shore verifies it, you can upgrade it here.
          </p>
          <Link href={CREATE_ORGANIZATION_HREF} className={`mt-3 ${primaryButton}`}>Create an organization page</Link>
        </div>
      )
    default:
      return null
  }
}

/**
 * The Organization Pro part of Membership & billing: the organizations this member owns or
 * administers, each with its plan and one clear next step, or why nothing can be bought yet.
 */
export function OrganizationProChooser({
  path,
  candidates,
  priceLine = null,
  highlight = false,
}: {
  /** Null when the organizations could not be loaded. */
  path: OrganizationProPath | null
  candidates: OrganizationProCandidate[]
  priceLine?: string | null
  highlight?: boolean
}) {
  const upgradable = candidates.filter((candidate) => candidate.verified && candidate.plan !== 'organization_pro').length
  const choosing = upgradable > 1

  return (
    <section
      id="organization-pro"
      aria-labelledby="organization-pro-title"
      className={`scroll-mt-24 rounded-2xl border bg-white p-5 shadow-[var(--shadow-card)] sm:p-6 ${highlight ? 'border-teal-300 ring-2 ring-teal-100' : 'border-mist-100'}`}
    >
      <div className="flex gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
          <Building2 aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Organization plan</p>
          <h2 id="organization-pro-title" className="mt-0.5 text-xl font-bold text-navy-950">Organization Pro</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            {choosing
              ? 'Choose the organization to upgrade. Organization Pro belongs to the organization and is paid for by its owner or an administrator; members use it through their role.'
              : 'Organization Pro belongs to the organization and is paid for by its owner or an administrator. Members use it through their workspace role.'}
          </p>
          {priceLine ? <p className="mt-1 text-sm font-semibold text-navy-900">{priceLine}</p> : null}
        </div>
      </div>

      <div className="mt-4 space-y-3 border-t border-mist-100 pt-4">
        {candidates.length ? (
          <ul aria-label="Organizations you manage" className="space-y-2">
            {candidates.map((organization) => <CandidateRow key={organization.id} organization={organization} />)}
          </ul>
        ) : null}
        {!candidates.length || !path || path.kind === 'unverified' || path.kind === 'restricted' ? <Explanation path={path} /> : null}
      </div>
    </section>
  )
}
