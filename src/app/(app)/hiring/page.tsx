import type { Metadata } from 'next'
import Link from 'next/link'
import { getAccessContext } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { HiringSubnav } from '@/features/jobs/components/hiring-subnav'
import { hiringRepository } from '@/features/jobs/hiring-repository'
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

  const metricCards = [
    ['Active Jobs', metrics.activeJobs],
    ['Applicants', metrics.applicants],
    ['Shortlisted', metrics.shortlisted],
    ['Interviews', metrics.interviews],
    ['Selected', metrics.selected],
  ] as const

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <section className="overflow-hidden rounded-[2rem] bg-navy-950 p-6 text-white shadow-[var(--shadow-card)] sm:p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-200">Sea N Shore Hiring</p>
            <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Hiring</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/75">
              Publish personally as a verified independent recruiter or through an organization workspace you are authorized to represent.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
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
            <Link href="/plans" className="rounded-xl bg-amber-900 px-4 py-2 text-sm font-bold text-white">Compare plans</Link>
            <Link href="/organizations" className="rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-bold text-amber-950">Organizations</Link>
          </div>
        </section>
      ) : null}

      <HiringSubnav active="overview" />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {metricCards.map(([label, value]) => (
          <article key={label} className="rounded-[1.35rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
            <p className="text-sm font-medium text-muted">{label}</p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-navy-950">{value}</p>
          </article>
        ))}
      </section>

      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-navy-950">Recent vacancies</h2>
            <p className="mt-1 text-sm text-muted">Your latest personal and organization hiring activity.</p>
          </div>
          <Link href="/hiring/jobs" className="text-sm font-bold text-navy-950 hover:underline">View all vacancies</Link>
        </div>

        <div className="mt-5 divide-y divide-mist-100">
          {jobs.slice(0, 4).map((job) => (
            <article key={job.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold text-navy-950">{job.title}</h3>
                  {job.urgent ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800">Urgent</span> : null}
                  <span className="rounded-full bg-mist-50 px-2 py-0.5 text-xs font-semibold capitalize text-muted">{job.status}</span>
                </div>
                <p className="mt-1 text-sm font-semibold text-navy-900">Published as {job.publisherName}</p>
                <p className="mt-1 text-sm text-muted">
                  {[job.rank, job.vesselTypes[0], job.location].filter(Boolean).join(' · ') || (job.domain === 'sea' ? 'Sea job' : 'Shore job')}
                </p>
              </div>
              <Link href={`/hiring/jobs/${job.id}/applicants`} className="text-sm font-bold text-navy-950 hover:underline">
                {job.applicantCount} applicant{job.applicantCount === 1 ? '' : 's'}
              </Link>
            </article>
          ))}
          {jobs.length === 0 ? <p className="py-6 text-sm text-muted">No vacancies yet. Post your first maritime role to start building a candidate pipeline.</p> : null}
        </div>
      </section>
    </main>
  )
}
