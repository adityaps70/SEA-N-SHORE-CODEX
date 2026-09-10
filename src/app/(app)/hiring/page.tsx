import Link from 'next/link'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { hiringRepository } from '@/features/jobs/hiring-repository'
import { HiringSubnav } from '@/features/jobs/components/hiring-subnav'

function HiringAccessRequired() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="rounded-[2rem] border border-mist-100 bg-white p-8 text-center shadow-[var(--shadow-card)]">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Sea N Shore Hiring</p>
        <h1 className="mt-3 text-3xl font-bold text-navy-950">Hiring access</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted">
          You need an approved company owner, administrator or recruiter membership before you can manage maritime vacancies.
        </p>
        <Link href="/jobs" className="mt-6 inline-flex rounded-xl bg-navy-950 px-5 py-2.5 text-sm font-bold text-white">Explore Jobs</Link>
      </section>
    </main>
  )
}

export default async function HiringPage() {
  const user = await requireAwsUser()
  const company = await hiringRepository.getAuthorizedCompany(user.id)
  if (!company) return <HiringAccessRequired />

  const [metrics, jobs] = await Promise.all([
    hiringRepository.getDashboardMetrics(user.id, company.id),
    hiringRepository.listCompanyJobs(user.id, company.id),
  ])

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
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-white/75">
              <span className="font-semibold text-white">{company.name}</span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${company.verified ? 'bg-emerald-400/15 text-emerald-200' : 'bg-white/10 text-white/70'}`}>
                {company.verified ? 'Verified company' : 'Verification pending'}
              </span>
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold capitalize">{company.role}</span>
            </div>
          </div>
          <Link href="/hiring/jobs/new" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-navy-950 transition hover:bg-mist-50">
            Post a job
          </Link>
        </div>
      </section>

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
            <p className="mt-1 text-sm text-muted">Your latest sea and shore hiring activity.</p>
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
