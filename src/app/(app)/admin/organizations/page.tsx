import type { Metadata } from 'next'
import Link from 'next/link'
import { Building2, ClipboardCheck, ExternalLink, Search, Settings2, UserRound } from 'lucide-react'
import {
  AdminChip,
  AdminEmptyState,
  AdminFilterBar,
  AdminPageHeader,
  AdminPagination,
  AdminPanel,
  formatAdminDate,
  readAdminPage,
  type AdminChipTone,
} from '@/features/admin/components/admin-ui'
import { ADMIN_TABLE_DESKTOP_CLASS, AdminMobileCard, AdminMobileList } from '@/features/admin/components/admin-mobile-list'
import { requireAwsUser } from '@/features/auth/aws-queries'
import {
  ADMIN_ORGANIZATION_DIRECTORY_FILTERS,
  ADMIN_ORGANIZATION_STATUSES,
  adminRepository,
  type AdminOrganizationDirectoryFilter,
  type AdminOrganizationDirectoryStatus,
  type AdminOrganizationStatus,
} from '@/features/admin/repository'
import { organizationLogoUrl } from '@/features/organizations/organization-page-profile'
import { OrganizationLogo } from '@/features/profiles/components/organization-logo'
import { pluralize } from '@/lib/format'

export const metadata: Metadata = { title: 'Organizations · Admin' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** Same page size as the users list. */
const PAGE_SIZE = 50

const labels: Record<AdminOrganizationStatus, string> = {
  pending: 'Pending',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  rejected: 'Rejected',
  suspended: 'Suspended',
}

const directoryFilterLabels: Record<AdminOrganizationDirectoryFilter, string> = {
  all: 'All organizations',
  pending: 'Pending',
  changes_requested: 'Changes requested',
  verified: 'Verified',
  rejected: 'Rejected',
  suspended: 'Suspended',
  unclaimed: 'Unclaimed',
}

const directoryStatus: Record<AdminOrganizationDirectoryStatus, { label: string; tone: AdminChipTone }> = {
  verified: { label: 'Verified', tone: 'success' },
  approved: { label: 'Approved', tone: 'info' },
  pending: { label: 'Pending review', tone: 'warning' },
  changes_requested: { label: 'Changes requested', tone: 'warning' },
  rejected: { label: 'Rejected', tone: 'danger' },
  suspended: { label: 'Suspended', tone: 'danger' },
  no_application: { label: 'No application', tone: 'neutral' },
}

function readSingle(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function readQueueStatus(value: string | string[] | undefined): AdminOrganizationStatus {
  const candidate = readSingle(value)
  return ADMIN_ORGANIZATION_STATUSES.includes(candidate as AdminOrganizationStatus)
    ? candidate as AdminOrganizationStatus
    : 'pending'
}

function readDirectoryFilter(value: string | string[] | undefined): AdminOrganizationDirectoryFilter {
  const candidate = readSingle(value)
  // Older links used the review state "approved"; in the directory that is "verified".
  if (candidate === 'approved') return 'verified'
  return ADMIN_ORGANIZATION_DIRECTORY_FILTERS.includes(candidate as AdminOrganizationDirectoryFilter)
    ? candidate as AdminOrganizationDirectoryFilter
    : 'all'
}

function dateLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

const actionClass = 'inline-flex min-h-8 items-center whitespace-nowrap rounded-lg border border-mist-200 px-2.5 text-xs font-semibold text-navy-950 transition hover:border-ocean-200 hover:bg-ocean-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500'

function ViewTabs({ view }: { view: 'directory' | 'queue' }) {
  return (
    <AdminFilterBar
      label="Organization views"
      options={[
        { href: '/admin/organizations', label: 'All organizations', active: view === 'directory' },
        { href: '/admin/organizations?view=queue', label: 'Review queue', active: view === 'queue' },
      ]}
    />
  )
}

async function reviewQueue({ adminId, status }: { adminId: string; status: AdminOrganizationStatus }) {
  const applications = await adminRepository.listOrganizationApplications(adminId, status)

  return (
    <main className="space-y-4">
      <AdminPageHeader
        title="Organization reviews"
        meta={`${applications.length} in this view`}
        description="Oldest submissions first. Every decision is tied to the authenticated platform administrator and written to the audit trail."
      />

      <ViewTabs view="queue" />

      <AdminFilterBar
        label="Organization review filters"
        options={ADMIN_ORGANIZATION_STATUSES.map((item) => ({
          href: `/admin/organizations?view=queue&status=${item}`,
          label: labels[item],
          active: item === status,
        }))}
      />

      <section className="overflow-hidden rounded-xl border border-mist-100 bg-white">
        <div className="divide-y divide-mist-100">
          {applications.map((application) => (
            <article key={application.applicationId} className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-mist-50 text-navy-950"><Building2 aria-hidden="true" className="size-4" /></span>
                  <h3 className="truncate text-lg font-bold text-navy-950">{application.company.name}</h3>
                  {application.company.verified ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">Verified</span> : null}
                  <span className="rounded-full bg-mist-50 px-2.5 py-1 text-xs font-bold text-muted">{labels[application.status]}</span>
                </div>
                <p className="mt-3 text-sm text-muted">
                  Submitted by <span className="font-semibold text-navy-900">{application.applicant.fullName}</span>
                  {' · '}{application.applicantRole}
                  {' · '}{dateLabel(application.submittedAt)}
                </p>
                <p className="mt-1 truncate text-sm text-muted">{application.officialEmail}{application.company.type ? ` · ${application.company.type}` : ''}</p>
              </div>
              <Link href={`/admin/organizations/${application.applicationId}`} className="inline-flex min-h-8 items-center justify-center rounded-lg border border-mist-200 px-3 text-xs font-semibold text-navy-950 transition hover:border-ocean-200 hover:bg-ocean-50">
                Review application
              </Link>
            </article>
          ))}

          {applications.length === 0 ? (
            <div className="p-8 text-center">
              <p className="font-bold text-navy-950">No {labels[status].toLowerCase()} organization applications.</p>
              <p className="mt-1 text-sm text-muted">Choose another review state to inspect the rest of the employer queue.</p>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  )
}

async function organizationDirectory({
  adminId,
  query,
  status,
  page,
}: {
  adminId: string
  query: string
  status: AdminOrganizationDirectoryFilter
  page: number
}) {
  // One extra row tells us whether there is a next page.
  const result = await adminRepository.listOrganizations(adminId, {
    query,
    status,
    limit: PAGE_SIZE + 1,
    offset: (page - 1) * PAGE_SIZE,
  })
  const hasNextPage = result.organizations.length > PAGE_SIZE
  const organizations = result.organizations.slice(0, PAGE_SIZE)

  function directoryHref(next: { status?: AdminOrganizationDirectoryFilter; page?: number }) {
    const search = new URLSearchParams()
    if (query) search.set('q', query)
    const nextStatus = next.status ?? status
    if (nextStatus !== 'all') search.set('status', nextStatus)
    // Changing a filter starts again from the first page.
    if (next.page && next.page > 1) search.set('page', String(next.page))
    const value = search.toString()
    return `/admin/organizations${value ? `?${value}` : ''}`
  }

  return (
    <main className="space-y-4">
      <AdminPageHeader
        title="Organizations"
        meta={page > 1 || hasNextPage
          ? `${pluralize(result.total, 'organization')} · page ${page}`
          : pluralize(result.total, 'organization')}
        description="Every organization page on Sea N Shore, newest first. Applications waiting for a decision are in the review queue."
      />

      <ViewTabs view="directory" />

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <AdminFilterBar
          label="Organization status filters"
          options={ADMIN_ORGANIZATION_DIRECTORY_FILTERS.map((item) => ({
            href: directoryHref({ status: item }),
            label: directoryFilterLabels[item],
            active: item === status,
          }))}
        />
        <form method="get" action="/admin/organizations" className="flex gap-2 xl:w-96">
          <label className="relative flex-1">
            <span className="sr-only">Search organizations</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              name="q"
              defaultValue={query}
              maxLength={120}
              placeholder="Name, owner, email or location"
              className="min-h-9 w-full rounded-lg border border-mist-100 bg-white py-1.5 pl-9 pr-3 text-sm text-navy-950 outline-none focus:border-ocean-400 focus:ring-2 focus:ring-ocean-100"
            />
          </label>
          {status !== 'all' ? <input type="hidden" name="status" value={status} /> : null}
          <button type="submit" className="min-h-9 rounded-lg bg-navy-950 px-3 text-sm font-semibold text-white hover:bg-navy-900">
            Search
          </button>
        </form>
      </div>

      <AdminPanel>
        {organizations.length === 0 ? (
          <AdminEmptyState
            title={page > 1 ? 'No more organizations in this view.' : 'No organizations match this view.'}
            description="Try a different search term or status filter."
          />
        ) : (
          <>
          <AdminMobileList label="Organizations">
            {organizations.map((organization) => {
              const badge = directoryStatus[organization.status]
              return (
                <AdminMobileCard
                  key={organization.id}
                  title={organization.name}
                  href={`/organizations/${organization.slug}`}
                  leading={<OrganizationLogo logoUrl={organizationLogoUrl({ id: organization.id, logoPath: organization.logoPath })} size="sm" />}
                  subtitle={[organization.type ?? 'Type not set', organization.location].filter(Boolean).join(' · ')}
                  badges={organization.claimStatus === 'unclaimed' ? <AdminChip>Unclaimed</AdminChip> : null}
                  fields={[
                    { label: 'Status', value: <AdminChip tone={badge.tone}>{badge.label}</AdminChip> },
                    { label: 'Plan', value: organization.plan === 'organization_pro' ? 'Org Pro' : 'Free' },
                    { label: 'Owner', value: organization.owner?.fullName ?? 'No owner' },
                    { label: 'Members', value: organization.memberCount },
                  ]}
                  actions={[
                    { kind: 'link', href: `/organizations/${organization.slug}`, label: 'View page', icon: <ExternalLink aria-hidden="true" /> },
                    { kind: 'link', href: `/organizations/${organization.slug}/manage`, label: 'Manage', icon: <Settings2 aria-hidden="true" /> },
                    ...(organization.applicationId ? [{ kind: 'link' as const, href: `/admin/organizations/${organization.applicationId}`, label: 'Review application', icon: <ClipboardCheck aria-hidden="true" /> }] : []),
                    ...(organization.owner ? [{ kind: 'link' as const, href: `/admin/users/${organization.owner.id}`, label: `Owner: ${organization.owner.fullName}`, icon: <UserRound aria-hidden="true" /> }] : []),
                  ]}
                />
              )
            })}
          </AdminMobileList>
          <div className={ADMIN_TABLE_DESKTOP_CLASS}>
            <table className="w-full min-w-[62rem] table-fixed text-left text-sm">
              <colgroup>
                <col className="w-[27%]" />
                <col className="w-[13%]" />
                <col className="w-[14%]" />
                <col className="w-[7%]" />
                <col className="w-[11%]" />
                <col className="w-[9%]" />
                <col className="w-[11%]" />
                <col className="w-[8%]" />
              </colgroup>
              <thead className="border-b border-mist-100 bg-mist-50/70 text-xs font-semibold uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2.5">Organization</th>
                  <th scope="col" className="px-4 py-2.5">Location</th>
                  <th scope="col" className="px-4 py-2.5">Owner</th>
                  <th scope="col" className="px-4 py-2.5">Members</th>
                  <th scope="col" className="px-4 py-2.5">Plan</th>
                  <th scope="col" className="px-4 py-2.5">Created</th>
                  <th scope="col" className="px-4 py-2.5">Status</th>
                  <th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mist-100">
                {organizations.map((organization) => {
                  const badge = directoryStatus[organization.status]
                  return (
                    <tr key={organization.id} className="align-middle transition hover:bg-mist-50/60">
                      <td className="px-4 py-2.5">
                        <div className="flex min-w-0 items-center gap-3">
                          <OrganizationLogo logoUrl={organizationLogoUrl({ id: organization.id, logoPath: organization.logoPath })} size="sm" />
                          <div className="min-w-0">
                            <Link href={`/organizations/${organization.slug}`} className="block truncate font-semibold text-navy-950 hover:text-ocean-700 hover:underline" title={organization.name}>
                              {organization.name}
                            </Link>
                            <p className="truncate text-xs text-muted">{organization.type ?? 'Type not set'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="truncate px-4 py-2.5 text-navy-900" title={organization.location ?? undefined}>{organization.location ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        {organization.owner ? (
                          <Link href={`/admin/users/${organization.owner.id}`} className="block truncate font-medium text-navy-900 hover:text-ocean-700 hover:underline" title={organization.owner.fullName}>
                            {organization.owner.fullName}
                          </Link>
                        ) : <span className="text-muted">No owner</span>}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-navy-900">{organization.memberCount}</td>
                      <td className="px-4 py-2.5">
                        {organization.plan === 'organization_pro'
                          ? <AdminChip tone="info">Organization Pro</AdminChip>
                          : <span className="text-navy-900">Free</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-muted">{formatAdminDate(organization.createdAt)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          <AdminChip tone={badge.tone}>{badge.label}</AdminChip>
                          {organization.claimStatus === 'unclaimed' ? <AdminChip>Unclaimed</AdminChip> : null}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-col items-end gap-1">
                          <Link href={`/organizations/${organization.slug}`} className={actionClass}>
                            View page<span className="sr-only">: {organization.name}</span>
                          </Link>
                          <Link href={`/organizations/${organization.slug}/manage`} className={actionClass}>
                            Manage<span className="sr-only">: {organization.name}</span>
                          </Link>
                          {organization.applicationId ? (
                            <Link href={`/admin/organizations/${organization.applicationId}`} className={actionClass}>
                              Review<span className="sr-only">: {organization.name}</span>
                            </Link>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </AdminPanel>

      <AdminPagination
        label="Organization list pages"
        page={page}
        hasNext={hasNextPage}
        hrefFor={(target) => directoryHref({ page: target })}
      />
    </main>
  )
}

export default async function AdminOrganizationsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const user = await requireAwsUser()

  if (readSingle(params.view) === 'queue') {
    return reviewQueue({ adminId: user.id, status: readQueueStatus(params.status) })
  }

  return organizationDirectory({
    adminId: user.id,
    query: readSingle(params.q).trim().slice(0, 120),
    status: readDirectoryFilter(params.status),
    page: readAdminPage(params.page),
  })
}
