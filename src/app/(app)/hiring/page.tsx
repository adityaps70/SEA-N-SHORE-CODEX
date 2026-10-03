import type { Metadata } from 'next'
import Link from 'next/link'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { getAccessContext } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { HiringSubnav } from '@/features/jobs/components/hiring-subnav'
import { JobCompanyLogo } from '@/features/jobs/components/job-company-identity'
import { hiringRepository, managedJobLifecycle } from '@/features/jobs/hiring-repository'
import { jobStatusPresentation, todayIsoDate } from '@/features/jobs/job-lifecycle'
import { buildHiringPublisherOptions } from '@/features/jobs/publishers'

export const metadata: Metadata = { title: 'Hiring' }

export default async function HiringPage() {
  const user = await requireAwsUser()
  const [access, personal, companies, metrics, jobs] = await Promise.all([
    getAccessContext(user.id),
    hiringRepository.getPersonalPublisher(user.id),
    hiringRepository.listAuthorizedCompanies(user.id),
    hiringRepository.getManagedDashboardMetrics(user.id),
    hiringRepository.listManagedJobs(user.id),
  ])

  const publisherOptions = personal ? buildHiringPublisherOptions(access, personal, companies) : []
  const readyPublishers = publisherOptions.filter((option) => option.canPublish)
  const blockedPublishers = publisherOptions.filter((option) => !option.canPublish)

  const today = todayIsoDate()
  const metricCards = [
    ['Active Jobs', metrics.activeJobs],
    ['Applicants', metrics.applicants],
    ['Shortlisted', metrics.shortlisted],
    ['Interviews', metrics.interviews],
    ['Hired', metrics.selected],
  ] as const

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 pb-4 pt-0 max-md:space-y-4 md:px-6 md:py-8 lg:px-8">
      <MobilePageBar backHref="/jobs" title="Hiring" />
      <section className="overflow-hidden rounded-[2rem] bg-navy-950 p-6 text-white shadow-[var(--shadow-card)] max-md:rounded-2xl max-md:p-4 sm:p-8">
        <div className="flex flex-col gap-6 max-md:gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-200 max-md:hidden">Sea N Shore Hiring</p>
            <h1 className="mt-2 text-3xl font-bold max-md:sr-only sm:text-4xl">Hiring</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/75 max-md:hidden">
              Publish personally as a verified independent recruiter or through an organization workspace you are authorized to represent.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold max-md:mt-0">
              {readyPublishers.map((publisher) => (
                <span key={publisher.key} className="rounded-full bg-emerald-400/15 px-2.5 py-1 text-emerald-200">
                  Ready · {publisher.name}
                </span>
              ))}
              {readyPublishers.length === 0 ? (
                <span className="rounded-full bg-amber-300/15 px-2.5 py-1 text-amber-100">Publishing setup required</span>
              ) : null}
            </div>
          </div>
          <Link href="/hiring/jobs/new" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-navy-950 transition hover:bg-mist-50">
            Post a job
          </Link>
        </div>
      </section>

      {blockedPublishers.length ? (
        <section className="rounded-[1.5rem] border border-amber-200 bg-amber-50 p-5 sm:p-6">
          <h2 className="font-bold text-amber-950">More publishing identities can be unlocked</h2>
          <p className="mt-1 text-sm leading-6 text-amber-900">
            Verification and paid plan access are checked separately. Open Post a job to see the exact requirement for each identity.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/plans" className="rounded-xl bg-amber-900 px-4 py-2 text-sm font-bold text-white hover:bg-amber-950 transition-colors">Compare plans</Link>
            <Link href="/organizations" className="rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-bold text-amber-950 transition-colors hover:bg-amber-50">Organizations</Link>
          </div>
        </section>
      ) : null}

      <HiringSubnav active="overview" />

      <section aria-label="Hiring overview" className="grid gap-3 max-md:grid-cols-2 max-md:gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {metricCards.map(([label, value]) => (
          <article key={label} className="rounded-[1.35rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] max-md:rounded-2xl max-md:p-3 max-md:shadow-none max-md:last:col-span-2">
            <p className="text-sm font-medium text-muted max-md:text-[13px]">{label}</p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-navy-950 max-md:mt-0.5 max-md:text-2xl">{value}</p>
          </article>
        ))}
      </section>

      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] max-md:rounded-2xl max-md:p-4 max-md:shadow-none sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-navy-950 max-md:text-lg">Recent vacancies</h2>
            <p className="mt-1 text-sm text-muted max-md:hidden">Your latest personal and organization hiring activity.</p>
          </div>
          <Link href="/hiring/jobs" className="text-sm font-bold text-ocean-700 underline-offset-2 hover:text-navy-950 hover:underline">View all vacancies</Link>
        </div>

        <div className="mt-5 divide-y divide-mist-100">
          {jobs.slice(0, 4).map((job) => {
            const presentation = jobStatusPresentation(managedJobLifecycle(job), today)
            return (
              <article key={job.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <JobCompanyLogo name={job.publisherName} companyId={job.companyId} logoPath={job.companyLogoPath} size="sm" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/hiring/jobs/${job.id}/edit`} className="font-bold text-navy-950 hover:underline">{job.title}</Link>
                      {job.urgent ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800">Urgent</span> : null}
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${presentation.badgeClassName}`}>{presentation.label}</span>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-navy-900">
                      Published as{' '}
                      {job.companyId && job.companySlug ? (
                        <Link href={`/organizations/${job.companySlug}`} className="hover:underline">{job.publisherName}</Link>
                      ) : job.publisherName}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {[job.rank, job.vesselTypes[0], job.location].filter(Boolean).join(' · ') || (job.domain === 'sea' ? 'Sea job' : 'Shore job')}
                    </p>
                  </div>
                </div>
                <Link href={`/hiring/jobs/${job.id}/applicants`} className="shrink-0 text-sm font-bold text-ocean-700 underline-offset-2 hover:text-navy-950 hover:underline">
                  {job.applicantCount} applicant{job.applicantCount === 1 ? '' : 's'}
                  {job.newApplicantCount ? <span className="ml-2 rounded-full bg-ocean-50 px-2 py-0.5 text-xs font-bold text-ocean-800">{job.newApplicantCount} new</span> : null}
                </Link>
              </article>
            )
          })}
          {jobs.length === 0 ? <p className="py-6 text-sm text-muted">No vacancies yet. Post your first maritime role to start building a candidate pipeline.</p> : null}
        </div>
      </section>
    </div>
  )
}
