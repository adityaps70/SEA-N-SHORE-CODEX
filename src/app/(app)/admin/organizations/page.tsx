import Link from 'next/link'
import { Building2, Clock3 } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { ADMIN_ORGANIZATION_STATUSES, adminRepository, type AdminOrganizationStatus } from '@/features/admin/repository'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const labels: Record<AdminOrganizationStatus, string> = {
  pending: 'Pending',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  rejected: 'Rejected',
  suspended: 'Suspended',
}

function readStatus(value: string | string[] | undefined): AdminOrganizationStatus {
  const candidate = Array.isArray(value) ? value[0] : value
  return ADMIN_ORGANIZATION_STATUSES.includes(candidate as AdminOrganizationStatus)
    ? candidate as AdminOrganizationStatus
    : 'pending'
}

function dateLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export default async function AdminOrganizationsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const status = readStatus(params.status)
  const user = await requireAwsUser()
  const applications = await adminRepository.listOrganizationApplications(user.id, status)

  return (
    <main className="space-y-5">
      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Employer trust</p>
            <h2 className="mt-1 text-2xl font-bold text-navy-950">Organization reviews</h2>
            <p className="mt-2 text-sm text-muted">Oldest submissions first. Every decision is tied to the authenticated platform administrator and written to the audit trail.</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl bg-mist-50 px-3 py-2 text-sm font-semibold text-muted">
            <Clock3 aria-hidden="true" className="size-4" /> {applications.length} in this view
          </div>
        </div>

        <nav aria-label="Organization review filters" className="mt-5 flex flex-wrap gap-2">
          {ADMIN_ORGANIZATION_STATUSES.map((item) => (
            <Link
              key={item}
              href={`/admin/organizations?status=${item}`}
              className={`rounded-full px-3.5 py-2 text-sm font-bold transition ${item === status ? 'bg-navy-950 text-white' : 'bg-mist-50 text-navy-900 hover:bg-mist-100'}`}
            >
              {labels[item]}
            </Link>
          ))}
        </nav>
      </section>

      <section className="overflow-hidden rounded-[1.5rem] border border-mist-100 bg-white shadow-[var(--shadow-card)]">
        <div className="divide-y divide-mist-100">
          {applications.map((application) => (
            <article key={application.applicationId} className="grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-6">
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
              <Link href={`/admin/organizations/${application.applicationId}`} className="inline-flex min-h-10 items-center justify-center rounded-xl bg-navy-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-navy-900">
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
