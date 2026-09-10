import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, BadgeCheck, BriefcaseBusiness, CalendarClock, CheckCircle2, MapPin, Ship, Sparkles, TriangleAlert, WalletCards } from 'lucide-react'
import { ApplyJobButton } from '@/features/jobs/components/apply-job-button'
import { ReportJobButton } from '@/features/jobs/components/report-job-button'
import { SaveJobButton } from '@/features/jobs/components/save-job-button'
import { getJobDetailState } from '@/features/jobs/queries'

function formatDate(value: string | null) {
  if (!value) return null
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00Z`))
}

function formatSalary(value: number | null, currency: string | null) {
  if (value === null) return null
  return new Intl.NumberFormat('en', { style: 'currency', currency: currency ?? 'USD', maximumFractionDigits: 0 }).format(value)
}

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { job, alreadyApplied, isSaved, match, profileReady } = await getJobDetailState(id)
  if (!job) notFound()

  const salaryMin = formatSalary(job.salaryMin, job.salaryCurrency)
  const salaryMax = formatSalary(job.salaryMax, job.salaryCurrency)
  const salary = salaryMin && salaryMax ? `${salaryMin}–${salaryMax}` : salaryMin ?? salaryMax

  return (
    <section className="mx-auto w-full max-w-5xl py-2 pb-24 sm:py-5 sm:pb-8">
      <Link href="/jobs" className="mb-4 inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-muted hover:bg-mist-50 hover:text-navy-950"><ArrowLeft aria-hidden="true" className="size-4" />Back to jobs</Link>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <article className="rounded-[1.75rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-8">
          <div className="flex items-start gap-4">
            <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-navy-950 text-white"><BriefcaseBusiness aria-hidden="true" className="size-5" /></div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">{job.companyName}</p>{job.companyVerified ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800"><BadgeCheck aria-hidden="true" className="size-3.5" />Verified employer</span> : null}{job.urgent ? <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">Urgent joining</span> : null}</div>
              <h1 className="mt-1 text-3xl font-semibold tracking-[-.035em] text-navy-950 sm:text-4xl">{job.title}</h1>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium text-muted">
                <span className="inline-flex items-center gap-1.5"><Ship aria-hidden="true" className="size-4" />{job.domain === 'sea' ? 'Sea job' : 'Shore job'}{job.vesselTypes[0] ? ` · ${job.vesselTypes[0]}` : ''}</span>
                {job.location ? <span className="inline-flex items-center gap-1.5"><MapPin aria-hidden="true" className="size-4" />{job.location}</span> : null}
                {salary ? <span className="inline-flex items-center gap-1.5"><WalletCards aria-hidden="true" className="size-4" />{salary}{job.salaryPeriod ? `/${job.salaryPeriod}` : ''}</span> : null}
                {job.joiningFrom ? <span className="inline-flex items-center gap-1.5"><CalendarClock aria-hidden="true" className="size-4" />Joining {formatDate(job.joiningFrom)}</span> : null}
              </div>
            </div>
          </div>

          <p className="mt-6 text-lg leading-8 text-ink">{job.summary}</p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {job.rank ? <div className="rounded-2xl bg-mist-50 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-muted">Rank / role</p><p className="mt-1 font-semibold text-navy-950">{job.rank}</p></div> : null}
            {job.department ? <div className="rounded-2xl bg-mist-50 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-muted">Department</p><p className="mt-1 font-semibold text-navy-950">{job.department}</p></div> : null}
            {job.experienceMinYears !== null ? <div className="rounded-2xl bg-mist-50 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-muted">Experience</p><p className="mt-1 font-semibold text-navy-950">{job.experienceMinYears}+ years</p></div> : null}
            {job.regions.length ? <div className="rounded-2xl bg-mist-50 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-muted">Region</p><p className="mt-1 font-semibold text-navy-950">{job.regions.join(', ')}</p></div> : null}
            {job.applyUntil ? <div className="rounded-2xl bg-mist-50 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-muted">Apply by</p><p className="mt-1 font-semibold text-navy-950">{formatDate(job.applyUntil)}</p></div> : null}
            {job.recruiterVerified ? <div className="rounded-2xl bg-emerald-50 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Recruiter</p><p className="mt-1 inline-flex items-center gap-1 font-semibold text-emerald-900"><BadgeCheck aria-hidden="true" className="size-4" />Verified recruiter</p></div> : null}
          </div>

          {match ? (
            <section aria-labelledby="maritime-match-heading" className="mt-8 overflow-hidden rounded-[1.5rem] border border-ocean-700/20 bg-mist-50">
              <div className="flex items-center justify-between gap-4 bg-navy-950 px-5 py-4 text-white"><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-white/60">Sea N Shore intelligence</p><h2 id="maritime-match-heading" className="mt-1 inline-flex items-center gap-2 text-xl font-semibold"><Sparkles aria-hidden="true" className="size-5" />Your Maritime Match</h2></div><div className="text-right"><p className="text-3xl font-bold">{match.score}%</p><p className="text-xs text-white/60">profile fit</p></div></div>
              <div className="grid gap-5 p-5 md:grid-cols-2">
                <div><h3 className="text-sm font-semibold text-navy-950">What matches</h3>{match.reasons.length ? <ul className="mt-3 space-y-2">{match.reasons.map((reason) => <li key={reason} className="flex items-start gap-2 text-sm leading-6 text-ink"><CheckCircle2 aria-hidden="true" className="mt-1 size-4 shrink-0 text-emerald-700" />{reason}</li>)}</ul> : <p className="mt-2 text-sm text-muted">Add more Maritime Passport details to improve match explanations.</p>}</div>
                <div><h3 className="text-sm font-semibold text-navy-950">Check before applying</h3>{match.missingRequirements.length || match.warnings.length ? <ul className="mt-3 space-y-2">{[...match.missingRequirements, ...match.warnings].map((warning) => <li key={warning} className="flex items-start gap-2 text-sm leading-6 text-amber-900"><TriangleAlert aria-hidden="true" className="mt-1 size-4 shrink-0" />{warning}</li>)}</ul> : <p className="mt-2 text-sm font-medium text-emerald-800">No major profile gaps detected.</p>}</div>
              </div>
            </section>
          ) : !profileReady ? <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">Complete your <Link href="/profile" className="font-semibold underline">Maritime Passport</Link> to see an explainable fit score for this job.</div> : null}

          <div className="mt-8 grid gap-7 border-t border-mist-100 pt-7">
            <section aria-labelledby="job-description-heading"><h2 id="job-description-heading" className="text-xl font-semibold text-navy-950">About the role</h2><p className="mt-3 whitespace-pre-line text-sm leading-7 text-ink">{job.description}</p></section>
            {job.requirements ? <section aria-labelledby="job-requirements-heading"><h2 id="job-requirements-heading" className="text-xl font-semibold text-navy-950">Requirements</h2><p className="mt-3 whitespace-pre-line text-sm leading-7 text-ink">{job.requirements}</p></section> : null}
            {job.certificateRequirements.length ? <section><h2 className="text-xl font-semibold text-navy-950">Certificates</h2><div className="mt-3 flex flex-wrap gap-2">{job.certificateRequirements.map((item) => <span key={item} className="rounded-xl border border-mist-100 bg-mist-50 px-3 py-2 text-sm font-medium text-ink">{item}</span>)}</div></section> : null}
            {job.visaRequirements.length ? <section><h2 className="text-xl font-semibold text-navy-950">Visa requirements</h2><div className="mt-3 flex flex-wrap gap-2">{job.visaRequirements.map((item) => <span key={item} className="rounded-xl border border-mist-100 bg-mist-50 px-3 py-2 text-sm font-medium text-ink">{item}</span>)}</div></section> : null}
          </div>
        </article>

        <aside className="space-y-4 self-start lg:sticky lg:top-20">
          <div className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]"><p className="text-xs font-semibold uppercase tracking-[.12em] text-ocean-700">Apply with Sea N Shore</p><p className="mt-2 text-sm leading-6 text-muted">Your professional identity and Maritime Passport stay connected to this application.</p><div className="mt-4 flex flex-wrap gap-2"><ApplyJobButton jobId={job.id} alreadyApplied={alreadyApplied} /><SaveJobButton jobId={job.id} initialSaved={isSaved} /></div></div>
          <ReportJobButton jobId={job.id} />
        </aside>
      </div>

      <div className="sticky bottom-0 z-20 -mx-3 mt-5 flex items-center justify-between gap-2 border-t border-mist-100 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_rgba(15,23,42,.08)] backdrop-blur sm:hidden"><SaveJobButton jobId={job.id} initialSaved={isSaved} compact /><ApplyJobButton jobId={job.id} alreadyApplied={alreadyApplied} /></div>
    </section>
  )
}
