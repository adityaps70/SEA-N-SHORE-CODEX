import { Bookmark } from 'lucide-react'
import { JobCard } from '@/features/jobs/components/job-card'
import { JobsSubnav } from '@/features/jobs/components/jobs-subnav'
import { getSavedJobs } from '@/features/jobs/queries'

export default async function SavedJobsPage() {
  const jobs = await getSavedJobs()
  return (
    <section className="py-2 sm:py-5">
      <div className="rounded-[1.75rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-8">
        <div className="flex items-start gap-4"><div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-navy-950 text-white"><Bookmark aria-hidden="true" className="size-5" /></div><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Jobs workspace</p><h1 className="mt-1 text-3xl font-semibold tracking-[-.035em] text-navy-950">Saved Jobs</h1><p className="mt-2 max-w-2xl text-sm leading-7 text-muted">Keep promising sea and shore opportunities in one shortlist while you compare joining dates, requirements and employers.</p></div></div>
      </div>
      <JobsSubnav active="saved" />
      {jobs.length ? <div className="mt-5 grid gap-4 lg:grid-cols-2">{jobs.map((job) => <JobCard key={job.id} job={job} isSaved />)}</div> : <div className="mt-5 rounded-[1.5rem] border border-dashed border-mist-100 bg-white px-6 py-12 text-center"><p className="font-semibold text-navy-950">No saved jobs yet.</p><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">Save an opportunity from Jobs discovery or a job detail page and it will stay here for quick comparison.</p></div>}
    </section>
  )
}
