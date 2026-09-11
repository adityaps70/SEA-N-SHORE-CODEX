import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { HiringSubnav } from '@/features/jobs/components/hiring-subnav'
import { hiringRepository } from '@/features/jobs/hiring-repository'
import { JOB_APPLICATION_STATUSES, JOB_APPLICATION_STATUS_LABELS, type JobApplicationStatus } from '@/features/jobs/types'

const FILTERS: Array<{ value: JobApplicationStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'applied', label: 'Applied' },
  { value: 'under_review', label: 'Under review' },
  { value: 'shortlisted', label: 'Shortlisted' },
  { value: 'interview', label: 'Interview' },
  { value: 'selected', label: 'Selected' },
  { value: 'rejected', label: 'Rejected' },
]

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'SN'
}

function formatExperience(value: number | null) {
  if (value === null) return 'Not listed'
  return `${value} year${value === 1 ? '' : 's'}`
}

export default async function HiringApplicantsPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { jobId } = await params
  const query = await searchParams
  const requestedStatus = firstValue(query.status)
  const status = JOB_APPLICATION_STATUSES.includes(requestedStatus as JobApplicationStatus)
    ? requestedStatus as JobApplicationStatus
    : undefined

  const user = await requireAwsUser()
  const company = await hiringRepository.getAuthorizedCompany(user.id)
  if (!company) notFound()

  const jobs = await hiringRepository.listCompanyJobs(user.id, company.id)
  const job = jobs.find((item) => item.id === jobId)
  if (!job) notFound()

  const applicants = await hiringRepository.listApplicants(user.id, jobId, status)

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">{company.name}</p>
          <h1 className="mt-2 text-3xl font-bold text-navy-950">Applicants · {job.title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Candidates are ordered by Sea N Shore Match using structured Rank, Vessel experience, credentials, availability and other maritime profile signals.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/hiring/jobs/${jobId}/edit`} className="rounded-xl border border-mist-100 bg-white px-4 py-2.5 text-sm font-bold text-navy-950 hover:bg-mist-50">Edit vacancy</Link>
          <Link href="/hiring/jobs" className="rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-navy-900">All jobs</Link>
        </div>
      </div>

      <HiringSubnav active="jobs" />

      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)] sm:p-5">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((filter) => {
            const active = filter.value === 'all' ? !status : status === filter.value
            const href = filter.value === 'all'
              ? `/hiring/jobs/${jobId}/applicants`
              : `/hiring/jobs/${jobId}/applicants?status=${filter.value}`
            return (
              <Link
                key={filter.value}
                href={href}
                className={`rounded-full px-3.5 py-2 text-xs font-bold transition ${active ? 'bg-navy-950 text-white' : 'bg-mist-50 text-muted hover:bg-mist-100 hover:text-navy-950'}`}
              >
                {filter.label}
              </Link>
            )
          })}
        </div>
      </section>

      <section className="space-y-3">
        {applicants.map((applicant) => (
          <article key={applicant.applicationId} className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="flex min-w-0 gap-4">
                <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-navy-950 text-sm font-black text-white">
                  {initials(applicant.candidate.fullName)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold text-navy-950">{applicant.candidate.fullName}</h2>
                    <span className="rounded-full bg-mist-50 px-2.5 py-1 text-xs font-bold text-muted">
                      {JOB_APPLICATION_STATUS_LABELS[applicant.status]}
                    </span>
                    {applicant.match.score >= 80 ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">Strong Match</span> : null}
                  </div>
                  {applicant.candidate.headline ? <p className="mt-1 text-sm text-muted">{applicant.candidate.headline}</p> : null}

                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                    <div className="rounded-xl bg-mist-50 p-3">
                      <dt className="text-xs font-bold uppercase tracking-wide text-muted">Rank</dt>
                      <dd className="mt-1 font-semibold text-navy-950">{applicant.candidate.rank ?? 'Not listed'}</dd>
                    </div>
                    <div className="rounded-xl bg-mist-50 p-3">
                      <dt className="text-xs font-bold uppercase tracking-wide text-muted">Vessel</dt>
                      <dd className="mt-1 font-semibold text-navy-950">{applicant.candidate.vesselTypes.slice(0, 2).join(', ') || 'Not listed'}</dd>
                    </div>
                    <div className="rounded-xl bg-mist-50 p-3">
                      <dt className="text-xs font-bold uppercase tracking-wide text-muted">Availability</dt>
                      <dd className="mt-1 font-semibold text-navy-950">{applicant.candidate.availability ?? 'Not listed'}</dd>
                    </div>
                  </dl>

                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-muted">
                    <span>{formatExperience(applicant.candidate.sailingExperienceYears)} sailing experience</span>
                    {applicant.candidate.location ? <span>{applicant.candidate.location}</span> : null}
                    {applicant.match.reasons.slice(0, 2).map((reason) => <span key={reason}>✓ {reason}</span>)}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 lg:flex-col lg:items-end">
                <div className="text-left lg:text-right">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Match</p>
                  <p className="mt-1 text-3xl font-black text-navy-950">{applicant.match.score}%</p>
                </div>
                <Link href={`/hiring/applicants/${applicant.applicationId}`} className="rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-navy-900">
                  Review candidate
                </Link>
              </div>
            </div>
          </article>
        ))}

        {applicants.length === 0 ? (
          <section className="rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-8 text-center">
            <h2 className="text-xl font-bold text-navy-950">No applicants in this stage</h2>
            <p className="mt-2 text-sm text-muted">Try another pipeline filter or return to the vacancy list.</p>
          </section>
        ) : null}
      </section>
    </main>
  )
}
