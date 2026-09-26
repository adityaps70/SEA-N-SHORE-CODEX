import type { Metadata } from 'next'
import { AdminFilterBar, AdminPageHeader } from '@/features/admin/components/admin-ui'
import { Building2, CheckCircle2, UserRound } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import {
  ADMIN_COMPANY_ACCESS_STATUSES,
  adminRepository,
  type AdminCompanyAccessStatus,
} from '@/features/admin/repository'
import { CompanyAccessReviewActions } from '@/features/admin/components/company-access-review-actions'

export const metadata: Metadata = { title: 'Access requests · Admin' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const labels: Record<AdminCompanyAccessStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

function readStatus(value: string | string[] | undefined): AdminCompanyAccessStatus {
  const candidate = Array.isArray(value) ? value[0] : value
  return ADMIN_COMPANY_ACCESS_STATUSES.includes(candidate as AdminCompanyAccessStatus)
    ? candidate as AdminCompanyAccessStatus
    : 'pending'
}

function roleLabel(role: string) {
  if (role === 'administrator') return 'Organization administrator'
  if (role === 'recruiter') return 'Recruiter / HR'
  if (role === 'lms_manager') return 'LMS Manager'
  if (role === 'event_manager') return 'Event Manager'
  if (role === 'content_manager') return 'Content Manager'
  if (role === 'analyst') return 'Analyst'
  return 'Member / employee'
}

export default async function AdminOrganizationAccessPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const status = readStatus(params.status)
  const user = await requireAwsUser()
  const requests = await adminRepository.listCompanyAccessRequests(user.id, status)

  return (
    <main className="space-y-4">
      <AdminPageHeader
        title="Membership & role requests"
        meta={`${requests.length} in this view`}
        description="Requests to join an existing organization. Approval creates an individual membership; no shared company login is created."
      />

      <AdminFilterBar
        label="Organization access request filters"
        options={ADMIN_COMPANY_ACCESS_STATUSES.map((item) => ({
          href: `/admin/access?status=${item}`,
          label: labels[item],
          active: item === status,
        }))}
      />

      <section className="grid gap-4">
        {requests.map((request) => (
          <article
            key={request.id}
            className="rounded-xl border border-mist-100 bg-white p-5"
          >
            <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="grid size-9 place-items-center rounded-xl bg-mist-50 text-navy-950">
                    <Building2 aria-hidden="true" className="size-4" />
                  </span>
                  <h2 className="text-lg font-bold text-navy-950">{request.company.name}</h2>
                  {request.company.verified ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">
                      <CheckCircle2 aria-hidden="true" className="size-3.5" /> Verified
                    </span>
                  ) : null}
                  <span className="rounded-full bg-mist-50 px-2.5 py-1 text-xs font-bold text-muted">
                    {labels[request.status]}
                  </span>
                </div>

                <div className="mt-4 flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
                    <UserRound aria-hidden="true" className="size-4" />
                  </span>
                  <div>
                    <p className="font-semibold text-navy-950">{request.requester.fullName}</p>
                    <p className="mt-1 text-sm text-muted">
                      Requests <span className="font-semibold text-navy-900">{roleLabel(request.requestedRole)}</span>
                      {request.requester.headline ? ` · ${request.requester.headline}` : ''}
                    </p>
                  </div>
                </div>

                {request.message ? (
                  <div className="mt-4 rounded-xl bg-mist-50 p-4 text-sm leading-6 text-navy-900">
                    {request.message}
                  </div>
                ) : null}

                {request.reviewerNote ? (
                  <p className="mt-4 text-sm leading-6 text-muted">
                    <span className="font-semibold text-navy-900">Review note:</span> {request.reviewerNote}
                  </p>
                ) : null}
              </div>

              <div>
                {request.status === 'pending' ? (
                  <CompanyAccessReviewActions requestId={request.id} />
                ) : (
                  <div className="rounded-xl bg-mist-50 p-4 text-sm text-muted">
                    This request has already been reviewed.
                  </div>
                )}
              </div>
            </div>
          </article>
        ))}

        {requests.length === 0 ? (
          <section className="rounded-[1.5rem] border border-mist-100 bg-white p-8 text-center shadow-[var(--shadow-card)]">
            <p className="font-bold text-navy-950">No {labels[status].toLowerCase()} access requests.</p>
            <p className="mt-1 text-sm text-muted">Choose another review state to inspect the rest of the access queue.</p>
          </section>
        ) : null}
      </section>
    </main>
  )
}
