import type { Metadata } from 'next'
import Link from 'next/link'
import {
  AdminChip,
  AdminEmptyState,
  AdminFilterBar,
  AdminPageHeader,
  AdminPanel,
  formatAdminDate,
  type AdminChipTone,
} from '@/features/admin/components/admin-ui'
import { requireAwsUser } from '@/features/auth/aws-queries'
import {
  ADMIN_COMPANY_ACCESS_FILTERS,
  adminRepository,
  type AdminCompanyAccessFilter,
  type AdminCompanyAccessRequest,
} from '@/features/admin/repository'
import { CompanyAccessReviewActions } from '@/features/admin/components/company-access-review-actions'
import { accessRoleLabel } from '@/features/organizations/access-request-labels'
import { requestAgeDays, type PlatformFallbackReason } from '@/features/organizations/access-request-policy'

export const metadata: Metadata = { title: 'Access requests · Admin' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const filterLabels: Record<AdminCompanyAccessFilter, string> = {
  needs_platform: 'Needs Sea N Shore',
  with_organization: 'With the organization',
  approved: 'Approved',
  rejected: 'Declined',
  cancelled: 'Withdrawn',
}

const emptyCopy: Record<AdminCompanyAccessFilter, { title: string; description: string }> = {
  needs_platform: {
    title: 'Nothing needs Sea N Shore right now.',
    description: 'Requests appear here when an organization has no active owner or administrator, a request has waited 7 days, or a requester escalates.',
  },
  with_organization: {
    title: 'No requests are waiting on organizations.',
    description: 'Organizations decide their own requests. You can see them here read-only.',
  },
  approved: { title: 'No approved requests yet.', description: 'Approved requests from organizations and Sea N Shore are listed here.' },
  rejected: { title: 'No declined requests.', description: 'Declined requests from organizations and Sea N Shore are listed here.' },
  cancelled: { title: 'No withdrawn requests.', description: 'Requests withdrawn by the requester are listed here.' },
}

const fallbackCopy: Record<PlatformFallbackReason, { label: string; tone: AdminChipTone }> = {
  escalated: { label: 'Escalated by requester', tone: 'danger' },
  no_active_admin: { label: 'No active owner or admin', tone: 'warning' },
  overdue: { label: 'Waiting 7+ days', tone: 'warning' },
}

function readFilter(value: string | string[] | undefined): AdminCompanyAccessFilter {
  const candidate = Array.isArray(value) ? value[0] : value
  if (candidate === 'pending') return 'needs_platform'
  return ADMIN_COMPANY_ACCESS_FILTERS.includes(candidate as AdminCompanyAccessFilter)
    ? candidate as AdminCompanyAccessFilter
    : 'needs_platform'
}

function decidedBy(request: AdminCompanyAccessRequest) {
  if (request.status === 'cancelled') return `Withdrawn by the requester · ${formatAdminDate(request.reviewedAt)}`
  const who = request.reviewer?.fullName ?? 'Unknown reviewer'
  const via = request.decidedVia === 'platform' ? 'Sea N Shore' : request.decidedVia === 'organization' ? 'Organization admin' : 'Reviewer'
  return `${request.status === 'approved' ? 'Approved' : 'Declined'} by ${who} (${via}) · ${formatAdminDate(request.reviewedAt, true)}`
}

export default async function AdminOrganizationAccessPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const filter = readFilter(params.status)
  const user = await requireAwsUser()
  const [requests, counts] = await Promise.all([
    adminRepository.listCompanyAccessRequests(user.id, filter),
    adminRepository.countCompanyAccessRequests(user.id),
  ])
  const now = new Date()

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Access requests"
        meta={`${requests.length} in this view`}
        description="Each organization's owner and administrators approve or decline requests to join it. Sea N Shore decides only when an organization has no active owner or admin, a request has waited 7 days, or the requester escalates. Everything else is read-only here."
      />

      <AdminFilterBar
        label="Access request filters"
        options={ADMIN_COMPANY_ACCESS_FILTERS.map((item) => ({
          href: `/admin/access?status=${item}`,
          label: filterLabels[item],
          active: item === filter,
          count: counts[item],
        }))}
      />

      <AdminPanel>
        {requests.length ? (
          <ul className="divide-y divide-mist-100">
            {requests.map((request) => {
              const canAct = request.status === 'pending' && request.fallbackReason !== null
              const age = requestAgeDays(request.requestedAt, now)
              return (
                <li key={request.id} className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/organizations/${request.company.slug}`} className="font-semibold text-navy-950 hover:underline">{request.company.name}</Link>
                      {request.company.verified ? <AdminChip tone="success">Verified</AdminChip> : <AdminChip>Not verified</AdminChip>}
                      {request.company.suspended ? <AdminChip tone="danger">Suspended</AdminChip> : null}
                      {request.fallbackReason ? <AdminChip tone={fallbackCopy[request.fallbackReason].tone}>{fallbackCopy[request.fallbackReason].label}</AdminChip> : null}
                    </div>
                    <p className="text-sm text-muted">
                      {request.requester.slug ? (
                        <Link href={`/people/${request.requester.slug}`} className="font-semibold text-navy-900 hover:underline">{request.requester.fullName}</Link>
                      ) : (
                        <span className="font-semibold text-navy-900">{request.requester.fullName}</span>
                      )}
                      {' '}asked for <span className="font-semibold text-navy-900">{accessRoleLabel(request.requestedRole)}</span>
                      {' · '}{formatAdminDate(request.requestedAt)}
                      {request.status === 'pending' ? ` (${age === 0 ? 'today' : `${age} ${age === 1 ? 'day' : 'days'} ago`})` : ''}
                      {request.requester.headline ? ` · ${request.requester.headline}` : ''}
                    </p>
                    {request.status === 'pending' ? (
                      <p className="text-xs text-muted">
                        {request.activeAuthorityCount
                          ? `${request.activeAuthorityCount} active ${request.activeAuthorityCount === 1 ? 'owner or administrator' : 'owners or administrators'} can decide this.`
                          : 'The organization has no active owner or administrator.'}
                      </p>
                    ) : null}
                    {request.message ? <p className="rounded-lg bg-mist-50 px-3 py-2 text-sm leading-6 text-navy-900">{request.message}</p> : null}
                    {request.escalatedAt ? (
                      <div className="rounded-lg border border-red-100 bg-red-50/60 px-3 py-2 text-sm leading-6 text-navy-900">
                        <p className="font-semibold">Escalated {formatAdminDate(request.escalatedAt)}</p>
                        {request.escalationNote ? <p>{request.escalationNote}</p> : null}
                        {request.status === 'pending' && request.decidedVia === 'organization' && request.reviewedAt ? (
                          <p className="mt-1 text-muted">
                            Previously declined by {request.reviewer?.fullName ?? 'an organization admin'} on {formatAdminDate(request.reviewedAt)}
                            {request.reviewerNote ? `: “${request.reviewerNote}”` : '.'}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {request.status !== 'pending' ? (
                      <p className="text-sm text-muted">
                        {decidedBy(request)}
                        {request.status === 'approved' && request.grantedRole && request.grantedRole !== request.requestedRole
                          ? ` · granted ${accessRoleLabel(request.grantedRole)}`
                          : ''}
                        {request.reviewerNote ? <><br /><span className="text-navy-900">Note: {request.reviewerNote}</span></> : null}
                      </p>
                    ) : null}
                  </div>

                  <div>
                    {canAct ? (
                      <CompanyAccessReviewActions requestId={request.id} requestedRole={request.requestedRole} />
                    ) : request.status === 'pending' ? (
                      <p className="rounded-lg bg-mist-50 px-3 py-2 text-sm text-muted">
                        Read-only. The organization decides this request. Sea N Shore can step in after 7 days or if the requester escalates.
                      </p>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <AdminEmptyState title={emptyCopy[filter].title} description={emptyCopy[filter].description} />
        )}
      </AdminPanel>
    </div>
  )
}
