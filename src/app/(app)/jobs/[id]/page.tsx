import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, BriefcaseBusiness, CalendarClock, MapPin } from 'lucide-react'
import { ApplyJobButton } from '@/features/jobs/components/apply-job-button'
import { getJobApplicationState } from '@/features/jobs/queries'

function formatDeadline(value: string | null) {
  if (!value) return 'Open until filled'
  return `Apply by ${new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00Z`))}`
}

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { job, alreadyApplied } = await getJobApplicationState(id)
  if (!job) notFound()

  return (
    <section className="mx-auto w-full max-w-4xl py-2 sm:py-5">
      <Link href="/jobs" className="mb-4 inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-muted hover:bg-mist-50 hover:text-navy-950">
        <ArrowLeft aria-hidden="true" className="size-4" /> Back to jobs
      </Link>

      <article className="rounded-[1.75rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-8">
        <div className="flex items-start gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-navy-950 text-white">
            <BriefcaseBusiness aria-hidden="true" className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">{job.companyName}</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-.035em] text-navy-950">{job.title}</h1>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium text-muted">
              {job.location ? <span className="inline-flex items-center gap-1.5"><MapPin aria-hidden="true" className="size-4" />{job.location}</span> : null}
              <span className="inline-flex items-center gap-1.5"><CalendarClock aria-hidden="true" className="size-4" />{formatDeadline(job.applyUntil)}</span>
            </div>
          </div>
        </div>

        <p className="mt-6 text-lg leading-8 text-ink">{job.summary}</p>

        <div className="mt-8 grid gap-7">
          <section aria-labelledby="job-description-heading">
            <h2 id="job-description-heading" className="text-lg font-semibold text-navy-950">About the role</h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-7 text-ink">{job.description}</p>
          </section>
          {job.requirements ? (
            <section aria-labelledby="job-requirements-heading">
              <h2 id="job-requirements-heading" className="text-lg font-semibold text-navy-950">Requirements</h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-7 text-ink">{job.requirements}</p>
            </section>
          ) : null}
        </div>

        <div className="mt-8 border-t border-mist-100 pt-6">
          <ApplyJobButton jobId={job.id} alreadyApplied={alreadyApplied} />
          <p className="mt-3 text-xs leading-5 text-muted">Your application is linked to your signed-in Sea N Shore professional identity and will appear under My Activities.</p>
        </div>
      </article>
    </section>
  )
}
