import Link from 'next/link'
import { ArrowRight, BriefcaseBusiness, CalendarClock, MapPin } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { JobListing } from '../types'

function formatDeadline(value: string | null) {
  if (!value) return 'Open until filled'
  return `Apply by ${new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00Z`))}`
}

export function JobCard({ job }: { job: JobListing }) {
  return (
    <Card className="border border-mist-100 p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-navy-950 text-white">
          <BriefcaseBusiness aria-hidden="true" className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[.12em] text-ocean-700">{job.companyName}</p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-.025em] text-navy-950">{job.title}</h2>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs font-medium text-muted">
            {job.location ? (
              <span className="inline-flex items-center gap-1.5"><MapPin aria-hidden="true" className="size-3.5" />{job.location}</span>
            ) : null}
            <span className="inline-flex items-center gap-1.5"><CalendarClock aria-hidden="true" className="size-3.5" />{formatDeadline(job.applyUntil)}</span>
          </div>
          <p className="mt-4 text-sm leading-6 text-ink">{job.summary}</p>
          <Link
            href={`/jobs/${job.id}`}
            className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-navy-900"
          >
            View opportunity <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </div>
    </Card>
  )
}
