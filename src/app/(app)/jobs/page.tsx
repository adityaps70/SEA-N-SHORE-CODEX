import Link from 'next/link'
import { BriefcaseBusiness, History } from 'lucide-react'
import { JobCard } from '@/features/jobs/components/job-card'
import { getPublishedJobs } from '@/features/jobs/queries'

export default async function JobsPage() {
  const jobs = await getPublishedJobs()

  return (
    <section className="py-2 sm:py-5">
      <div className="rounded-[1.75rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-navy-950 text-white">
              <BriefcaseBusiness aria-hidden="true" className="size-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Sea N Shore Jobs</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-[-.035em] text-navy-950">Maritime opportunities built around real experience.</h1>
              <p className="mt-2 max-w-2xl leading-7 text-muted">Discover published sailing and shore opportunities, apply with your Sea N Shore identity, and follow every application from one workspace.</p>
            </div>
          </div>
          <Link href="/activities" className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border border-mist-100 px-4 text-sm font-semibold text-navy-950 hover:bg-mist-50">
            <History aria-hidden="true" className="size-4" /> My applications
          </Link>
        </div>
      </div>

      {jobs.length ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {jobs.map((job) => <JobCard key={job.id} job={job} />)}
        </div>
      ) : (
        <div className="mt-5 rounded-[1.5rem] border border-dashed border-mist-100 bg-white px-6 py-12 text-center">
          <p className="font-semibold text-navy-950">No published maritime opportunities right now.</p>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">New sailing and shore roles will appear here as soon as they are published.</p>
        </div>
      )}
    </section>
  )
}
