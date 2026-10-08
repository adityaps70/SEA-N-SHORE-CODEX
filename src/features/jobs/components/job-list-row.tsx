import Link from 'next/link'
import type { ReactNode } from 'react'
import { relativeTimeFrom } from '@/lib/relative-time'
import { isApplyUntilOpen, todayIsoDate } from '../job-lifecycle'
import type { JobListing, JobMatchResult } from '../types'
import { jobMatchDisplay } from '../match-display'
import { JobCompanyLogo } from './job-company-identity'
import { SaveJobButton } from './save-job-button'

function formatJoining(job: JobListing) {
  if (job.urgent) return 'Immediate joining'
  if (job.joiningFrom) {
    const date = new Date(`${job.joiningFrom}T00:00:00Z`)
    if (!Number.isNaN(date.getTime())) {
      return `Joining ${new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date)}`
    }
  }
  if (job.domain === 'shore') return 'Shore job'
  return job.vesselTypes[0] ?? null
}

/**
 * Phone job row (round 8): logo tile, title, company, location · joining, one meta line
 * (match · Easy Apply · age) and a bookmark toggle. The whole row opens the job.
 */
export function JobListRow({
  job,
  match = null,
  isSaved = false,
  alreadyApplied = false,
  className = '',
}: {
  job: JobListing
  match?: JobMatchResult | null
  isSaved?: boolean
  alreadyApplied?: boolean
  className?: string
}) {
  const open = isApplyUntilOpen(job.applyUntil, todayIsoDate())
  const place = [job.location, formatJoining(job)].filter(Boolean).join(' · ')
  const applyState = alreadyApplied ? 'Applied' : !open ? 'Applications closed' : job.easyApply ? 'Easy Apply' : null
  const age = relativeTimeFrom(job.publishedAt ?? job.createdAt)
  // Round 12: no badge for no match or below 40%; banded labels from 40%.
  const display = jobMatchDisplay(match)

  return (
    <li className={`relative flex gap-3 px-4 py-3.5 hover:bg-mist-50/70 ${className}`} data-job-row>
      <JobCompanyLogo name={job.companyName} companyId={job.companyId} logoPath={job.companyLogoPath} size="md" />
      <div className="min-w-0 flex-1">
        <Link
          href={`/jobs/${job.id}`}
          className="line-clamp-2 text-[15px] font-semibold leading-5 text-ocean-700 after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ocean-500"
        >
          {job.title}
        </Link>
        <p className="mt-0.5 truncate text-sm text-ink">
          {job.companyName}
          {job.companyVerified ? <span className="sr-only"> (verified employer)</span> : null}
        </p>
        {place ? <p className="mt-0.5 line-clamp-2 text-[13px] text-muted">{place}</p> : null}
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted">
          {display?.showInList ? <span className="font-semibold text-ocean-800">{display.text}</span> : null}
          {display?.showInList && (applyState || age) ? <span aria-hidden="true">·</span> : null}
          {applyState ? <span className={applyState === 'Applications closed' ? 'font-medium text-amber-800' : ''}>{applyState}</span> : null}
          {applyState && age ? <span aria-hidden="true">·</span> : null}
          {age ? <span>{age}</span> : null}
        </p>
      </div>
      <div className="-mr-2 -mt-1.5 shrink-0">
        <SaveJobButton jobId={job.id} initialSaved={isSaved} variant="icon" jobTitle={job.title} />
      </div>
    </li>
  )
}

/** Divided list wrapper for phone job rows. */
export function JobRowList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <ul aria-label={label} className="divide-y divide-mist-100">
      {children}
    </ul>
  )
}
