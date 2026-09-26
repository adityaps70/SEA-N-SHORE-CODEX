import type { Metadata } from 'next'
import Link from 'next/link'
import { Building2, CheckCircle2, Clock3, UserRound } from 'lucide-react'
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
    <main className="space-y-5">
      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Organization access</p>
            <h1 className="mt-1 text-2xl font-bold text-navy-950">Membership & role requests</h1>
            <p className="mt-2 text-sm leading-6 text-muted">
              Review requests to join an existing organization. Approval creates the individual membership; no shared company login is created.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl bg-mist-50 px-3 py-2 text-sm font-semibold text-muted">
            <Clock3 aria-hidden="true" className="size-4" /> {requests.length} in this view
          </div>
        </div>

        <nav aria-label="Organization access request filters" className="mt-5 flex flex-wrap gap-2">
          {ADMIN_COMPANY_ACCESS_STATUSES.map((item) => (
            <Link
              key={item}
              href={`/admin/access?status=${item}`}
              className={`rounded-full px-3.5 py-2 text-sm font-bold transition ${
                item === status ? 'bg-navy-950 text-white' : 'bg-mist-50 text-navy-900 hover:bg-mist-100'
              }`}
            >
              {labels[item]}
            </Link>
          ))}
        </nav>
      </section>

      <section className="grid gap-4">
        {requests.map((request) => (
          <article
            key={request.id}
            className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6"
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
