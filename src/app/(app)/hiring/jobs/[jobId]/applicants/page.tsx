import type { Metadata } from 'next'
import Link from 'next/link'
import { jobMatchDisplay } from '@/features/jobs/match-display'
import { notFound } from 'next/navigation'
import { FileText, MessageSquareText } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { applicantPhotoUrl } from '@/features/jobs/applicant-media'
import { HIRING_APPLICATION_STATUS_BADGES, HIRING_APPLICATION_STATUS_LABELS } from '@/features/jobs/application-status'
import { ApplicantAvatar } from '@/features/jobs/components/applicant-avatar'
import { hiringCvHref } from '@/features/jobs/components/hiring-cv-link'
import { HiringSubnav } from '@/features/jobs/components/hiring-subnav'
import { JobCompanyIdentity } from '@/features/jobs/components/job-company-identity'
import { hiringRepository, managedJobLifecycle } from '@/features/jobs/hiring-repository'
import { jobStatusPresentation, todayIsoDate } from '@/features/jobs/job-lifecycle'
import { JOB_APPLICATION_STATUSES, type JobApplicationStatus } from '@/features/jobs/types'
import { formatYears } from '@/lib/format'

export const metadata: Metadata = { title: 'Applicants' }

/** Owner-facing pipeline stages; values are the stored application statuses. */
const FILTERS: Array<{ value: JobApplicationStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'applied', label: HIRING_APPLICATION_STATUS_LABELS.applied },
  { value: 'under_review', label: HIRING_APPLICATION_STATUS_LABELS.under_review },
  { value: 'shortlisted', label: HIRING_APPLICATION_STATUS_LABELS.shortlisted },
  { value: 'interview', label: HIRING_APPLICATION_STATUS_LABELS.interview },
  { value: 'selected', label: HIRING_APPLICATION_STATUS_LABELS.selected },
  { value: 'rejected', label: HIRING_APPLICATION_STATUS_LABELS.rejected },
  { value: 'withdrawn', label: HIRING_APPLICATION_STATUS_LABELS.withdrawn },
]

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date not recorded'
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
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
  const jobs = await hiringRepository.listManagedJobs(user.id)
  const job = jobs.find((item) => item.id === jobId)
  if (!job) notFound()

  const allApplicants = await hiringRepository.listApplicants(user.id, jobId)
  const counts = new Map<JobApplicationStatus, number>()
  for (const applicant of allApplicants) counts.set(applicant.status, (counts.get(applicant.status) ?? 0) + 1)
  const applicants = status ? allApplicants.filter((applicant) => applicant.status === status) : allApplicants
  const photoUrls = new Map(await Promise.all(
    applicants.map(async (applicant) => [applicant.applicationId, await applicantPhotoUrl(applicant.candidate.avatarPath)] as const),
  ))

  const today = todayIsoDate()
  const presentation = jobStatusPresentation(managedJobLifecycle(job), today)
  const visibleFilters = FILTERS.filter((filter) => filter.value !== 'withdrawn' || (counts.get('withdrawn') ?? 0) > 0)

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 pb-4 pt-0 max-md:space-y-4 md:px-6 md:py-8 lg:px-8">
      <MobilePageBar
        backHref="/hiring/jobs"
        title="Applicants"
        right={<Link href={`/hiring/jobs/${jobId}/edit`} className="inline-flex min-h-11 items-center rounded-full px-3 text-[15px] font-semibold text-ocean-700 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500">Edit</Link>}
      />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="max-md:hidden">
          <JobCompanyIdentity
            name={job.publisherName}
            companyId={job.companyId}
            companySlug={job.companySlug}
            logoPath={job.companyLogoPath}
            location={job.companyLocation}
            verified={job.companyVerified}
            size="sm"
            personalLabel="Personal recruiter"
          />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 max-md:mt-0">
            <h1 className="min-w-0 break-words text-2xl font-bold text-navy-950 max-md:text-lg sm:text-3xl">Applicants · {job.title}</h1>
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${presentation.badgeClassName}`}>{presentation.label}</span>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted max-md:hidden">
            {presentation.key === 'live'
              ? 'Candidates are ordered by Sea N Shore Match using structured Rank, Vessel experience, credentials and other maritime profile signals.'
              : presentation.description}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 max-md:hidden">
          <Link href={`/hiring/jobs/${jobId}/edit`} className="inline-flex min-h-10 items-center rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-950 hover:bg-mist-50">Edit vacancy</Link>
          <Link href="/hiring/jobs" className="inline-flex min-h-10 items-center rounded-xl bg-navy-950 px-4 text-sm font-bold text-white hover:bg-navy-900">All jobs</Link>
        </div>
      </div>

      <HiringSubnav active="jobs" />

      {allApplicants.length ? (
        <nav aria-label="Filter applicants by status" className="rounded-[1.5rem] border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)] max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none sm:p-5">
          <div className="flex flex-wrap gap-2 max-md:-mx-4 max-md:flex-nowrap max-md:overflow-x-auto max-md:px-4 max-md:py-1">
            {visibleFilters.map((filter) => {
              const active = filter.value === 'all' ? !status : status === filter.value
              const count = filter.value === 'all' ? allApplicants.length : counts.get(filter.value) ?? 0
              const href = filter.value === 'all'
                ? `/hiring/jobs/${jobId}/applicants`
                : `/hiring/jobs/${jobId}/applicants?status=${filter.value}`
              return (
                <Link
                  key={filter.value}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded-full px-3.5 py-2 text-xs font-bold transition max-md:inline-flex max-md:min-h-9 max-md:shrink-0 max-md:items-center max-md:whitespace-nowrap max-md:text-sm ${active ? 'bg-navy-950 text-white' : 'bg-mist-50 text-muted hover:bg-mist-100 hover:text-navy-950 max-md:bg-white max-md:ring-1 max-md:ring-mist-100'}`}
                >
                  {filter.label} <span className={active ? 'text-white/70' : ''}>{count}</span>
                </Link>
              )
            })}
          </div>
        </nav>
      ) : null}

      <section aria-label="Applicants" className="space-y-3">
        {applicants.map((applicant) => {
          const candidate = applicant.candidate
          const profileHref = candidate.slug ? `/people/${candidate.slug}` : null
          const display = jobMatchDisplay(applicant.match)
          return (
            <article key={applicant.applicationId} className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] max-md:rounded-2xl max-md:p-4 max-md:shadow-none sm:p-6">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="flex min-w-0 gap-4">
                  <ApplicantAvatar name={candidate.fullName} photoUrl={photoUrls.get(applicant.applicationId) ?? null} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="min-w-0 break-words text-lg font-bold text-navy-950">
                        {profileHref ? <Link href={profileHref} className="hover:text-ocean-700 hover:underline">{candidate.fullName}</Link> : candidate.fullName}
                      </h2>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${HIRING_APPLICATION_STATUS_BADGES[applicant.status]}`}>
                        {HIRING_APPLICATION_STATUS_LABELS[applicant.status]}
                      </span>
                      {display?.band === 'strong' ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">Strong match</span> : null}
                    </div>
                    {candidate.headline ? <p className="mt-1 text-sm text-muted">{candidate.headline}</p> : null}
                    {!candidate.accountActive ? <p className="mt-1 text-sm font-semibold text-amber-900">This member’s account is no longer active. Their application is kept for your records.</p> : null}

                    <dl className="mt-4 grid gap-3 text-sm max-md:mt-3 max-md:grid-cols-2 max-md:gap-2 sm:grid-cols-2">
                      <div className="rounded-xl bg-mist-50 p-3">
                        <dt className="text-xs font-bold uppercase tracking-wide text-muted">Rank</dt>
                        <dd className="mt-1 font-semibold text-navy-950">{candidate.rank ?? 'Not listed'}</dd>
                      </div>
                      <div className="rounded-xl bg-mist-50 p-3">
                        <dt className="text-xs font-bold uppercase tracking-wide text-muted">Vessel</dt>
                        <dd className="mt-1 font-semibold text-navy-950">{candidate.vesselTypes.slice(0, 2).join(', ') || 'Not listed'}</dd>
                      </div>
                    </dl>

                    {applicant.coverNote ? (
                      <p className="mt-3 flex gap-2 text-sm leading-6 text-ink">
                        <MessageSquareText aria-hidden="true" className="mt-1 size-4 shrink-0 text-ocean-700" />
                        <span className="line-clamp-2">{applicant.coverNote}</span>
                      </p>
                    ) : null}

                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-muted">
                      <span>Applied {formatDate(applicant.appliedAt)}</span>
                      <span>{formatYears(candidate.sailingExperienceYears)} sailing experience</span>
                      {candidate.location ? <span>{candidate.location}</span> : null}
                      {applicant.cvAttachment ? (
                        <a href={hiringCvHref(applicant.applicationId)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ocean-700 hover:underline">
                          <FileText aria-hidden="true" className="size-3.5" />
                          CV attached
                        </a>
                      ) : <span>No CV attached</span>}
                      {applicant.match.reasons.slice(0, 2).map((reason) => <span key={reason}>✓ {reason}</span>)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4 max-md:border-t max-md:border-mist-100 max-md:pt-3 lg:flex-col lg:items-end">
                  <div className="text-left lg:text-right">
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Match</p>
                    {/* Round 12: the same numbers and labels the candidate sees. */}
                    {display && display.band !== 'low' ? (
                      <>
                        <p className="mt-1 text-3xl font-black text-navy-950 max-md:mt-0 max-md:text-2xl">{display.score}%</p>
                        <p className="text-xs font-semibold text-muted">{display.label}</p>
                      </>
                    ) : (
                      <p className="mt-1 text-lg font-black text-navy-950 max-md:mt-0">{display ? display.label : 'Not scored'}</p>
                    )}
                  </div>
                  <Link href={`/hiring/applicants/${applicant.applicationId}`} className="inline-flex min-h-10 items-center rounded-xl bg-navy-950 px-4 text-sm font-bold text-white hover:bg-navy-900">
                    Review application
                  </Link>
                </div>
              </div>
            </article>
          )
        })}

        {allApplicants.length === 0 ? (
          <section className="rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-8 text-center">
            <h2 className="text-xl font-bold text-navy-950">No applicants yet</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">
              {presentation.key === 'draft'
                ? 'This job is still a draft. Publish it to start receiving applications.'
                : presentation.key === 'live'
                  ? 'Applications will appear here as soon as someone applies. Share the job link to reach more candidates.'
                  : presentation.description}
            </p>
            <Link href={presentation.key === 'live' ? `/jobs/${jobId}` : `/hiring/jobs/${jobId}/edit`} className="mt-5 inline-flex rounded-xl bg-navy-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-900">
              {presentation.key === 'live' ? 'View live job' : 'Manage this job'}
            </Link>
          </section>
        ) : applicants.length === 0 ? (
          <section className="rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-8 text-center">
            <h2 className="text-xl font-bold text-navy-950">No applicants in this stage</h2>
            <p className="mt-2 text-sm text-muted">Try another stage, or show all applicants.</p>
            <Link href={`/hiring/jobs/${jobId}/applicants`} className="mt-5 inline-flex rounded-xl border border-mist-200 px-5 py-2.5 text-sm font-bold text-navy-950 hover:bg-mist-50">Show all applicants</Link>
          </section>
        ) : null}
      </section>
    </div>
  )
}
