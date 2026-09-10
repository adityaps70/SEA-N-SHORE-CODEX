import Link from 'next/link'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { HiringSubnav } from '@/features/jobs/components/hiring-subnav'
import { hiringRepository } from '@/features/jobs/hiring-repository'

export default async function HiringJobsPage() {
  const user = await requireAwsUser()
  const company = await hiringRepository.getAuthorizedCompany(user.id)

  if (!company) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <section className="rounded-[2rem] border border-mist-100 bg-white p-8 text-center shadow-[var(--shadow-card)]">
          <h1 className="text-3xl font-bold text-navy-950">Hiring access required</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted">An approved owner, administrator or recruiter company membership is required to manage vacancies.</p>
        </section>
      </main>
    )
  }

  const jobs = await hiringRepository.listCompanyJobs(user.id, company.id)

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">{company.name}</p>
          <h1 className="mt-2 text-3xl font-bold text-navy-950">Company jobs</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">Manage sea and shore vacancies, review applicants and keep every recruitment stage visible.</p>
        </div>
        <Link href="/hiring/jobs/new" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-navy-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900">
          Post a job
        </Link>
      </div>

      <HiringSubnav active="jobs" />

      <section className="space-y-3">
        {jobs.map((job) => (
          <article key={job.id} className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold text-navy-950">{job.title}</h2>
                  <span className="rounded-full bg-mist-50 px-2.5 py-1 text-xs font-bold capitalize text-muted">{job.status}</span>
                  {job.urgent ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800">Urgent</span> : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-muted">
                  <span className="rounded-full border border-mist-100 px-2.5 py-1 capitalize">{job.domain === 'sea' ? 'Sea job' : 'Shore job'}</span>
                  {job.rank ? <span className="rounded-full border border-mist-100 px-2.5 py-1">{job.rank}</span> : null}
                  {job.vesselTypes.slice(0, 2).map((vessel) => <span key={vessel} className="rounded-full border border-mist-100 px-2.5 py-1">{vessel}</span>)}
                  {job.location ? <span className="rounded-full border border-mist-100 px-2.5 py-1">{job.location}</span> : null}
                </div>
                <p className="mt-3 text-sm text-muted"><span className="font-bold text-navy-950">{job.applicantCount}</span> applicant{job.applicantCount === 1 ? '' : 's'}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Link href={`/hiring/jobs/${job.id}/applicants`} className="rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-navy-900">
                  View applicants
                </Link>
                <Link href={`/hiring/jobs/${job.id}/edit`} className="rounded-xl border border-mist-100 bg-white px-4 py-2.5 text-sm font-bold text-navy-950 hover:bg-mist-50">
                  Edit
                </Link>
              </div>
            </div>
          </article>
        ))}

        {jobs.length === 0 ? (
          <section className="rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-8 text-center">
            <h2 className="text-xl font-bold text-navy-950">No company vacancies yet</h2>
            <p className="mt-2 text-sm text-muted">Create a structured maritime role and Sea N Shore will use candidate profile data to improve discovery and matching.</p>
            <Link href="/hiring/jobs/new" className="mt-5 inline-flex rounded-xl bg-navy-950 px-5 py-2.5 text-sm font-bold text-white">Post a job</Link>
          </section>
        ) : null}
      </section>
    </main>
  )
}
