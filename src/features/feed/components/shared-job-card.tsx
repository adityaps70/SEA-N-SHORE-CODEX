import Link from '@/components/navigation/intent-link'
import { BriefcaseBusiness, MapPin } from 'lucide-react'
import type { FeedJobShare } from '../types'

/**
 * Round I (I1): the job attached to a post made with "Share to feed": a "Job" label, the job's title, company and
 * place, and Apply (counted as feed_share). Once the job closes the card says so instead of offering Apply.
 */
export function SharedJobCard({ job }: { job: FeedJobShare }) {
  const href = `/jobs/${job.jobId}?src=feed_share`
  return (
    <section aria-label={`Job: ${job.title}`} className="mt-3 flex flex-col gap-3 rounded-2xl border border-mist-100 bg-mist-50/70 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="shared-job-card">
      <div className="min-w-0">
        <p className="inline-flex items-center gap-1 rounded-full bg-ocean-50 px-2 py-0.5 text-xs font-bold text-ocean-800"><BriefcaseBusiness aria-hidden="true" className="size-3.5" />Job</p>
        <p className="mt-1.5 break-words text-[15px] font-bold leading-snug text-navy-950">
          {job.open ? <Link href={href} className="hover:underline">{job.title}</Link> : job.title}
        </p>
        <p className="mt-0.5 break-words text-sm text-muted">
          {job.companyName}
          {job.location ? <><span aria-hidden="true"> · </span><span className="inline-flex items-center gap-1"><MapPin aria-hidden="true" className="size-3.5" />{job.location}</span></> : null}
        </p>
      </div>
      {job.open ? (
        <Link href={href} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-navy-950 px-5 text-sm font-bold text-white transition hover:bg-navy-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500" aria-label={`Apply for ${job.title}`}>
          Apply
        </Link>
      ) : (
        <p className="shrink-0 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">This job is closed</p>
      )}
    </section>
  )
}
