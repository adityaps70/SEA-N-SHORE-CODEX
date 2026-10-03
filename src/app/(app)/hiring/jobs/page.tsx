import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronRight, Plus } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { PlanHiddenBanner } from '@/features/billing/components/plan-hidden-banner'
import { HiringJobLifecycleActions } from '@/features/jobs/components/hiring-job-lifecycle-actions'
import { HiringJobRowMenu } from '@/features/jobs/components/hiring-job-row-menu'
import { HiringSubnav } from '@/features/jobs/components/hiring-subnav'
import { JobCompanyIdentity } from '@/features/jobs/components/job-company-identity'
import { hiringRepository, managedJobLifecycle, type ManagedHiringJobSummary } from '@/features/jobs/hiring-repository'
import { jobStatusPresentation, todayIsoDate, type JobStatusKey } from '@/features/jobs/job-lifecycle'

export const metadata: Metadata = { title: 'Your job posts' }

type JobsFilter = 'all' | 'live' | 'draft' | 'archived'

const FILTERS: Array<{ value: JobsFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'live', label: 'Live' },
  { value: 'draft', label: 'Drafts' },
  { value: 'archived', label: 'Archived' },
]

const NOTICES: Record<string, string> = {
  deleted: 'Job deleted. It no longer appears in job search or in your jobs.',
  published: 'Job published. It is now visible in job search.',
  draft: 'Draft saved. Publish it when it is ready.',
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function filterFor(key: JobStatusKey): JobsFilter {
  if (key === 'draft') return 'draft'
  if (key === 'live' || key === 'expired') return 'live'
  return 'archived'
}

function formatDate(value: string | null) {
  if (!value) return null
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value))
}

function jobDateLine(job: ManagedHiringJobSummary, key: JobStatusKey) {
  if (key === 'draft') return job.createdAt ? `Created ${formatDate(job.createdAt)}` : null
  if (key === 'archived' || key === 'removed') return job.archivedAt ? `Archived ${formatDate(job.archivedAt)}` : null
  const parts = [job.publishedAt ? `Published ${formatDate(job.publishedAt)}` : null, job.applyUntil ? `Apply by ${formatDate(`${job.applyUntil}T00:00:00Z`)}` : null]
  return parts.filter(Boolean).join(' · ') || null
}

export default async function HiringJobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = await searchParams
  const requestedFilter = firstValue(query.status)
  const filter: JobsFilter = FILTERS.some((item) => item.value === requestedFilter) ? requestedFilter as JobsFilter : 'all'
  const notice = NOTICES[firstValue(query.notice) ?? ''] ?? null

  const user = await requireAwsUser()
  const jobs = await hiringRepository.listManagedJobs(user.id)
  const today = todayIsoDate()
  const withStatus = jobs.map((job) => ({ job, presentation: jobStatusPresentation(managedJobLifecycle(job), today) }))
  const counts: Record<JobsFilter, number> = { all: jobs.length, live: 0, draft: 0, archived: 0 }
  for (const item of withStatus) counts[filterFor(item.presentation.key)] += 1
  const visible = filter === 'all' ? withStatus : withStatus.filter((item) => filterFor(item.presentation.key) === filter)

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 pb-4 pt-0 max-md:space-y-4 md:px-6 md:py-8 lg:px-8">
      <MobilePageBar
        backHref="/hiring"
        title="Your jobs"
        right={(
          <Link href="/hiring/jobs/new" aria-label="Post a job" className="grid size-11 place-items-center rounded-full text-navy-950 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500">
            <Plus aria-hidden="true" className="size-6" />
          </Link>
        )}
      />
      <div className="flex flex-col gap-4 max-md:hidden sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Sea N Shore Hiring</p>
          <h1 className="mt-2 text-3xl font-bold text-navy-950">Your jobs</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Manage vacancies published personally or through any organization workspace you are authorized to represent.
          </p>
        </div>
        <Link href="/hiring/jobs/new" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-navy-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900">
          Post a job
        </Link>
      </div>

      <HiringSubnav active="jobs" />

      {notice ? (
        <p role="status" className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">{notice}</p>
      ) : null}

      {jobs.length ? (
        <nav aria-label="Filter jobs by status" className="flex flex-wrap gap-2 max-md:-mx-4 max-md:flex-nowrap max-md:overflow-x-auto max-md:px-4 max-md:py-1">
          {FILTERS.map((item) => {
            const active = item.value === filter
            return (
              <Link
                key={item.value}
                href={item.value === 'all' ? '/hiring/jobs' : `/hiring/jobs?status=${item.value}`}
                aria-current={active ? 'page' : undefined}
                className={`rounded-full px-3.5 py-2 text-xs font-bold transition max-md:inline-flex max-md:min-h-9 max-md:shrink-0 max-md:items-center max-md:whitespace-nowrap max-md:text-sm ${active ? 'bg-navy-950 text-white' : 'bg-white text-muted ring-1 ring-mist-100 hover:bg-mist-50 hover:text-navy-950'}`}
              >
                {item.label} <span className={active ? 'text-white/70' : 'text-muted'}>{counts[item.value]}</span>
              </Link>
            )
          })}
        </nav>
      ) : null}

      <section className="space-y-3">
        {visible.map(({ job, presentation }) => {
          const dateLine = jobDateLine(job, presentation.key)
          return (
            <article key={job.id} className="relative rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] max-md:rounded-2xl max-md:p-4 max-md:shadow-none sm:p-6">
              <div className="absolute right-3 top-3 md:hidden">
                <HiringJobRowMenu jobId={job.id} jobTitle={job.title} lifecycle={managedJobLifecycle(job)} today={today} live={presentation.key === 'live' || presentation.key === 'expired'} applicantCount={job.applicantCount} />
              </div>
              <div className="flex flex-col gap-5 max-md:gap-2 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1 max-md:pr-10">
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
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <h2 className="min-w-0 break-words text-lg font-bold text-navy-950">{job.title}</h2>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${presentation.badgeClassName}`}>{presentation.label}</span>
                    {job.urgent ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800">Urgent</span> : null}
                  </div>
                  <p className="mt-1 text-sm text-muted max-md:hidden">{presentation.description}</p>
                  {job.hiddenForPlan ? <PlanHiddenBanner companyId={job.companyId} className="mt-3" /> : null}
                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-muted max-md:hidden">
                    <span className="rounded-full border border-mist-100 px-2.5 py-1">{job.domain === 'sea' ? 'Sea job' : 'Shore job'}</span>
                    {job.rank ? <span className="rounded-full border border-mist-100 px-2.5 py-1">{job.rank}</span> : null}
                    {job.vesselTypes.slice(0, 2).map((vessel) => <span key={vessel} className="rounded-full border border-mist-100 px-2.5 py-1">{vessel}</span>)}
                    {job.location ? <span className="rounded-full border border-mist-100 px-2.5 py-1">{job.location}</span> : null}
                  </div>
                  <Link href={`/hiring/jobs/${job.id}/applicants`} className="mt-1 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-ocean-700 hover:underline md:hidden">
                    {job.applicantCount} applicant{job.applicantCount === 1 ? '' : 's'}
                    {job.newApplicantCount ? <span className="rounded-full bg-ocean-50 px-2 py-0.5 text-xs font-bold text-ocean-800">{job.newApplicantCount} new</span> : null}
                    <ChevronRight aria-hidden="true" className="size-4" />
                  </Link>
                  {dateLine ? <p className="text-[13px] text-muted md:hidden">{dateLine}</p> : null}
                  <p className="mt-3 text-sm text-muted max-md:hidden">
                    <span className="font-bold text-navy-950">{job.applicantCount}</span> applicant{job.applicantCount === 1 ? '' : 's'}
                    {job.newApplicantCount ? <span className="ml-2 rounded-full bg-ocean-50 px-2 py-0.5 text-xs font-bold text-ocean-800">{job.newApplicantCount} new</span> : null}
                    {dateLine ? <span className="ml-2">· {dateLine}</span> : null}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 max-md:hidden lg:justify-end">
                  <Link href={`/hiring/jobs/${job.id}/applicants`} className="inline-flex min-h-10 items-center rounded-xl bg-navy-950 px-4 text-sm font-bold text-white hover:bg-navy-900">
                    View applicants
                  </Link>
                  <Link href={`/hiring/jobs/${job.id}/edit`} className="inline-flex min-h-10 items-center rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-950 hover:bg-mist-50">
                    Edit
                  </Link>
                  {presentation.key === 'live' || presentation.key === 'expired' ? (
                    <Link href={`/jobs/${job.id}`} className="inline-flex min-h-10 items-center rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-950 hover:bg-mist-50">
                      View live job
                    </Link>
                  ) : null}
                </div>
              </div>
              <div className="mt-4 border-t border-mist-100 pt-4 max-md:hidden">
                <HiringJobLifecycleActions jobId={job.id} jobTitle={job.title} lifecycle={managedJobLifecycle(job)} today={today} />
                {job.status === 'published' ? (
                  <p className="mt-2 text-xs text-muted">To delete a live job, archive it first so candidates stop applying.</p>
                ) : null}
                {!job.canDelete && job.status !== 'published' ? (
                  <p className="mt-2 text-xs text-muted">Only the person who posted this job, or an owner or administrator of the organization, can delete it.</p>
                ) : null}
              </div>
            </article>
          )
        })}

        {jobs.length > 0 && visible.length === 0 ? (
          <section className="rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-8 text-center">
            <h2 className="text-xl font-bold text-navy-950">No jobs in this view</h2>
            <p className="mt-2 text-sm text-muted">Choose another filter to see the rest of your jobs.</p>
            <Link href="/hiring/jobs" className="mt-5 inline-flex rounded-xl border border-mist-200 px-5 py-2.5 text-sm font-bold text-navy-950 hover:bg-mist-50">Show all jobs</Link>
          </section>
        ) : null}

        {jobs.length === 0 ? (
          <section className="rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-8 text-center">
            <h2 className="text-xl font-bold text-navy-950">No vacancies yet</h2>
            <p className="mt-2 text-sm text-muted">Post your first maritime role using your personal recruiter identity or an organization workspace.</p>
            <Link href="/hiring/jobs/new" className="mt-5 inline-flex rounded-xl bg-navy-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-800 transition-colors">Post a job</Link>
          </section>
        ) : null}
      </section>
    </div>
  )
}
