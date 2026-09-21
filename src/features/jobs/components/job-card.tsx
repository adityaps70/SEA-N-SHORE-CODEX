import Link from 'next/link'
import { ArrowRight, BadgeCheck, CalendarClock, MapPin, Ship, WalletCards } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { JobListing, JobMatchResult } from '../types'
import { ApplyJobButton } from './apply-job-button'
import { SaveJobButton } from './save-job-button'

function formatDate(value: string | null, prefix: string) {
  if (!value) return null
  return `${prefix} ${new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }).format(new Date(`${value}T00:00:00Z`))}`
}

function formatSalary(job: JobListing) {
  if (job.salaryMin === null && job.salaryMax === null) return null
  const currency = job.salaryCurrency ?? 'USD'
  const format = (value: number) => new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value)
  const amount = job.salaryMin !== null && job.salaryMax !== null
    ? `${format(job.salaryMin)}–${format(job.salaryMax)}`
    : format(job.salaryMin ?? job.salaryMax ?? 0)
  return `${amount}${job.salaryPeriod ? `/${job.salaryPeriod}` : ''}`
}

function companyInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'SN'
}

export function JobCard({
  job,
  match = null,
  isSaved = false,
  alreadyApplied = false,
}: {
  job: JobListing
  match?: JobMatchResult | null
  isSaved?: boolean
  alreadyApplied?: boolean
}) {
  const salary = formatSalary(job)
  const joining = formatDate(job.joiningFrom, 'Joining')
  const strongestReason = match?.reasons[0] ?? null
  const warning = match?.missingRequirements[0] ?? match?.warnings[0] ?? null
  const chips = [job.rank, job.department, job.domain === 'sea' ? job.vesselTypes[0] : null]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 2)

  return (
    <Card className="group flex h-full flex-col border border-mist-100 p-5 transition duration-200 hover:-translate-y-0.5 hover:border-ocean-200 hover:shadow-lg">
      <div className="flex items-start gap-3.5">
        {job.companyLogoPath && job.companyId ? (
          // eslint-disable-next-line @next/next/no-img-element -- authenticated company media is served through a first-party route
          <img
            src={`/api/company-logo/${job.companyId}`}
            alt={`${job.companyName} logo`}
            loading="lazy"
            className="size-12 shrink-0 rounded-2xl border border-mist-100 bg-white object-contain p-1.5 shadow-sm"
          />
        ) : (
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-navy-950 text-sm font-black text-white shadow-sm">
            {companyInitials(job.companyName)}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-[11px] font-bold uppercase tracking-[0.11em] text-ocean-700">
              {job.companyName}
            </p>
            {job.companyVerified ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                <BadgeCheck aria-hidden="true" className="size-3.5" />
                Verified
              </span>
            ) : null}
            {job.urgent ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                Urgent
              </span>
            ) : null}
          </div>

          <Link
            href={`/jobs/${job.id}`}
            className="mt-1.5 block line-clamp-2 text-[1.25rem] font-bold leading-tight tracking-[-.025em] text-navy-950 group-hover:text-ocean-700"
          >
            {job.title}
          </Link>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold text-muted">
        <span className="inline-flex items-center gap-1.5">
          <Ship aria-hidden="true" className="size-3.5" />
          {job.domain === 'sea' ? (job.vesselTypes[0] ?? 'Sea job') : 'Shore job'}
        </span>
        {job.location ? (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="line-clamp-1">{job.location}</span>
          </span>
        ) : null}
        {salary ? (
          <span className="inline-flex items-center gap-1.5">
            <WalletCards aria-hidden="true" className="size-3.5" />
            {salary}
          </span>
        ) : null}
        {joining ? (
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock aria-hidden="true" className="size-3.5" />
            {joining}
          </span>
        ) : null}
      </div>

      {chips.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {chips.map((value) => (
            <span key={value} className="rounded-lg bg-mist-50 px-2.5 py-1 text-xs font-semibold text-navy-950">
              {value}
            </span>
          ))}
        </div>
      ) : null}

      <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted">{job.summary}</p>

      {match ? (
        <div data-job-match className="mt-4 border-t border-mist-100 pt-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-bold text-ocean-700">Your match</span>
            <span className="rounded-full bg-navy-950 px-2.5 py-1 text-xs font-black text-white">{match.score}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-mist-100">
            <div
              className="h-full rounded-full bg-teal-400"
              style={{ width: `${Math.max(0, Math.min(100, match.score))}%` }}
            />
          </div>
          {strongestReason ? (
            <p className="mt-2 line-clamp-1 text-xs font-medium text-ink">{strongestReason}</p>
          ) : warning ? (
            <p className="mt-2 line-clamp-1 text-xs font-medium text-amber-800">Gap: {warning}</p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
        {job.easyApply ? (
          <ApplyJobButton jobId={job.id} alreadyApplied={alreadyApplied} compact />
        ) : (
          <Link
            href={`/jobs/${job.id}`}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-navy-900"
          >
            View opportunity <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        )}
        <SaveJobButton jobId={job.id} initialSaved={isSaved} compact />
      </div>
    </Card>
  )
}
