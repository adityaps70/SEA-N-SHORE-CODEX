import type { Metadata } from 'next'
import { Bookmark } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { JobCard } from '@/features/jobs/components/job-card'
import { JobListRow, JobRowList } from '@/features/jobs/components/job-list-row'
import { JobsSubnav } from '@/features/jobs/components/jobs-subnav'
import { MyJobsChips } from '@/features/jobs/components/my-jobs-chips'
import { getSavedJobs } from '@/features/jobs/queries'

export const metadata: Metadata = { title: 'Saved jobs' }

export default async function SavedJobsPage() {
  const jobs = await getSavedJobs()
  return (
    <section className="pb-2 pt-0 md:py-5">
      <MobilePageBar backHref="/jobs" title="My jobs" />
      <MyJobsChips active="saved" />
      <div className="rounded-[1.75rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] max-md:hidden sm:p-8">
        <div className="flex items-start gap-4"><div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-navy-950 text-white"><Bookmark aria-hidden="true" className="size-5" /></div><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Jobs workspace</p><h1 className="mt-1 text-3xl font-semibold tracking-[-.035em] text-navy-950">Saved Jobs</h1><p className="mt-2 max-w-2xl text-sm leading-7 text-muted">Keep promising sea and shore opportunities in one shortlist while you compare joining dates, requirements and employers.</p></div></div>
      </div>
      <JobsSubnav active="saved" className="max-md:hidden" />
      {jobs.length ? (
        <div className="-mx-4 border-y border-mist-100 bg-white md:hidden">
          <JobRowList label="Saved jobs">{jobs.map((job) => <JobListRow key={job.id} job={job} isSaved />)}</JobRowList>
        </div>
      ) : null}
      {jobs.length ? <div className="mt-5 grid gap-4 max-md:hidden lg:grid-cols-2">{jobs.map((job) => <JobCard key={job.id} job={job} isSaved />)}</div> : <div className="mt-5 max-md:mt-2 rounded-[1.5rem] border border-dashed border-mist-100 bg-white px-6 py-12 text-center"><p className="font-semibold text-navy-950">No saved jobs yet.</p><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">Save an opportunity from Jobs discovery or a job detail page and it will stay here for quick comparison.</p></div>}
    </section>
  )
}
