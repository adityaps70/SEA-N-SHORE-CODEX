import Link from 'next/link'
import { ArrowRight, BadgeCheck, BriefcaseBusiness, CalendarClock, MapPin, Ship, Sparkles, TriangleAlert, WalletCards } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { JobListing, JobMatchResult } from '../types'
import { SaveJobButton } from './save-job-button'

function formatDate(value: string | null, prefix: string) {
  if (!value) return null
  return `${prefix} ${new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }).format(new Date(`${value}T00:00:00Z`))}`
}

function formatSalary(job: JobListing) {
  if (job.salaryMin === null && job.salaryMax === null) return null
  const currency = job.salaryCurrency ?? 'USD'
  const format = (value: number) => new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
  const amount = job.salaryMin !== null && job.salaryMax !== null
    ? `${format(job.salaryMin)}–${format(job.salaryMax)}`
    : format(job.salaryMin ?? job.salaryMax ?? 0)
  return `${amount}${job.salaryPeriod ? `/${job.salaryPeriod}` : ''}`
}

export function JobCard({ job, match = null, isSaved = false }: { job: JobListing; match?: JobMatchResult | null; isSaved?: boolean }) {
  const salary = formatSalary(job)
  const joining = formatDate(job.joiningFrom, 'Joining')
  const strongestReason = match?.reasons[0] ?? null
  const warning = match?.missingRequirements[0] ?? match?.warnings[0] ?? null

  return (
    <Card className="group border border-mist-100 p-5 transition hover:-translate-y-0.5 hover:shadow-lg sm:p-6">
      <div className="flex items-start gap-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-navy-950 text-white"><BriefcaseBusiness aria-hidden="true" className="size-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-[.12em] text-ocean-700">{job.companyName}</p>
            {job.companyVerified ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800"><BadgeCheck aria-hidden="true" className="size-3.5" />Verified</span> : null}
            {job.urgent ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Urgent</span> : null}
          </div>
          <Link href={`/jobs/${job.id}`} className="mt-1 block text-xl font-semibold tracking-[-.025em] text-navy-950 group-hover:text-ocean-700">{job.title}</Link>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs font-medium text-muted">
            <span className="inline-flex items-center gap-1.5"><Ship aria-hidden="true" className="size-3.5" />{job.domain === 'sea' ? (job.vesselTypes[0] ?? 'Sea job') : 'Shore job'}</span>
            {job.location ? <span className="inline-flex items-center gap-1.5"><MapPin aria-hidden="true" className="size-3.5" />{job.location}</span> : null}
            {salary ? <span className="inline-flex items-center gap-1.5"><WalletCards aria-hidden="true" className="size-3.5" />{salary}</span> : null}
            {joining ? <span className="inline-flex items-center gap-1.5"><CalendarClock aria-hidden="true" className="size-3.5" />{joining}</span> : null}
          </div>

          {(job.rank || job.department || job.regions.length) ? <div className="mt-3 flex flex-wrap gap-2">{[job.rank, job.department, job.regions[0]].filter(Boolean).map((value) => <span key={value} className="rounded-lg bg-mist-50 px-2.5 py-1 text-xs font-semibold text-navy-950">{value}</span>)}</div> : null}

          <p className="mt-4 line-clamp-2 text-sm leading-6 text-ink">{job.summary}</p>

          {match ? (
            <div className="mt-4 rounded-2xl border border-ocean-700/15 bg-mist-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ocean-700"><Sparkles aria-hidden="true" className="size-3.5" />Your match</span>
                <span className="text-sm font-bold text-navy-950">{match.score}%</span>
              </div>
              {strongestReason ? <p className="mt-1.5 text-xs leading-5 text-ink">✓ {strongestReason}</p> : null}
              {warning ? <p className="mt-1 inline-flex items-start gap-1.5 text-xs leading-5 text-amber-800"><TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />{warning}</p> : null}
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Link href={`/jobs/${job.id}`} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-navy-900">{job.easyApply ? 'Easy Apply' : 'View opportunity'} <ArrowRight aria-hidden="true" className="size-4" /></Link>
            <SaveJobButton jobId={job.id} initialSaved={isSaved} compact />
          </div>
        </div>
      </div>
    </Card>
  )
}
