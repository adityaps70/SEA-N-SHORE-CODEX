import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { RailFooter } from '@/components/navigation/rail-footer'
import { backLinkClass, secondaryButtonClass } from '@/components/ui/interactive-styles'
import { ArrowLeft, BadgeCheck, CalendarClock, CheckCircle2, MapPin, Ship, TriangleAlert, WalletCards } from 'lucide-react'
import { ApplyJobButton } from '@/features/jobs/components/apply-job-button'
import { ClampedText } from '@/features/jobs/components/clamped-text'
import { JobDetailMoreMenu } from '@/features/jobs/components/job-detail-more-menu'
import { JobMatchRow } from '@/features/jobs/components/job-match-row'
import { JobShareActions } from '@/features/jobs/components/job-share-actions'
import { JobCompanyIdentity, JobCompanyLogo } from '@/features/jobs/components/job-company-identity'
import { ReportJobButton } from '@/features/jobs/components/report-job-button'
import { SaveJobButton } from '@/features/jobs/components/save-job-button'
import { isApplyUntilOpen, todayIsoDate } from '@/features/jobs/job-lifecycle'
import { getJobDetailState } from '@/features/jobs/queries'
import { relativeTimeFrom } from '@/lib/relative-time'

function formatDate(value: string | null) {
  if (!value) return null
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
}

function formatSalary(value: number | null, currency: string | null) {
  if (value === null) return null
  return new Intl.NumberFormat('en', { style: 'currency', currency: currency ?? 'USD', maximumFractionDigits: 0 }).format(value)
}

const loadJobDetail = cache((id: string) => getJobDetailState(id))

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const { job } = await loadJobDetail(id)
  if (!job) return { title: 'Job not found' }
  return { title: `${job.title} at ${job.companyName}`, description: job.summary ?? undefined }
}

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { job, alreadyApplied, isSaved, match, profileReady } = await loadJobDetail(id)
  if (!job) notFound()

  const salaryMin = formatSalary(job.salaryMin, job.salaryCurrency)
  const salaryMax = formatSalary(job.salaryMax, job.salaryCurrency)
  const salary = salaryMin && salaryMax ? `${salaryMin}–${salaryMax}` : salaryMin ?? salaryMax
  const acceptingApplications = isApplyUntilOpen(job.applyUntil, todayIsoDate())
  const companyHref = job.companyId && job.companySlug ? `/organizations/${job.companySlug}` : null
  const postedAge = relativeTimeFrom(job.publishedAt ?? job.createdAt)
  const postedLabel = postedAge ? `Posted ${postedAge}${/^\d+[mhd]$/.test(postedAge) ? ' ago' : ''}` : null
  const metaChip = 'inline-flex items-center gap-1.5 max-md:rounded-full max-md:bg-mist-50 max-md:px-2.5 max-md:py-1 max-md:text-[13px] max-md:font-semibold max-md:text-navy-900'
  const closedNotice = alreadyApplied
    ? null
    : <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-900">Applications for this job closed on {formatDate(job.applyUntil)}.</p>

  return (
    <section className="mx-auto w-full max-w-5xl pb-0 pt-0 md:pb-8 md:pt-5">
      <MobilePageBar
        backHref="/jobs"
        right={<JobDetailMoreMenu jobId={job.id} jobTitle={job.title} companyName={job.companyName} companyHref={companyHref} />}
      />
      <Link href="/jobs" className={`mb-4 max-md:hidden ${backLinkClass}`}><ArrowLeft aria-hidden="true" className="size-4" />Back to jobs</Link>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <article className="min-w-0 rounded-[1.75rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:border-t-0 max-md:p-4 max-md:shadow-none sm:p-8">
          <div className="flex items-start gap-4 max-md:flex-col max-md:items-center max-md:gap-3 max-md:text-center">
            <JobCompanyLogo name={job.companyName} companyId={job.companyId} logoPath={job.companyLogoPath} size="lg" />
            <div className="min-w-0 flex-1 max-md:flex max-md:w-full max-md:flex-col">
              <div className="flex flex-wrap items-center gap-2 max-md:order-2 max-md:mt-1 max-md:justify-center">{companyHref ? <Link href={companyHref} className="min-w-0 break-words text-xs font-semibold uppercase tracking-[.14em] text-ocean-700 hover:underline max-md:text-[15px] max-md:normal-case max-md:tracking-normal max-md:text-ink">{job.companyName}</Link> : <p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700 max-md:text-[15px] max-md:normal-case max-md:tracking-normal max-md:text-ink">{job.companyName}</p>}{job.companyVerified ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800"><BadgeCheck aria-hidden="true" className="size-3.5" />Verified employer</span> : null}{job.urgent ? <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">Urgent joining</span> : null}</div>
              <h1 className="mt-1 break-words text-2xl font-semibold tracking-[-.035em] text-navy-950 max-md:order-1 max-md:mt-0 max-md:text-[22px] max-md:font-bold max-md:leading-tight max-md:tracking-normal sm:text-4xl">{job.title}</h1>
              {postedLabel ? <p className="order-3 mt-0.5 text-[13px] text-muted md:hidden">{postedLabel}</p> : null}
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium text-muted max-md:order-4 max-md:justify-center max-md:gap-2">
                <span className={metaChip}><Ship aria-hidden="true" className="size-4" />{job.domain === 'sea' ? 'Sea job' : 'Shore job'}{job.vesselTypes[0] ? ` · ${job.vesselTypes[0]}` : ''}</span>
                {job.location ? <span className={metaChip}><MapPin aria-hidden="true" className="size-4" />{job.location}</span> : null}
                {salary ? <span className={metaChip}><WalletCards aria-hidden="true" className="size-4" />{salary}{job.salaryPeriod ? `/${job.salaryPeriod}` : ''}</span> : null}
                {job.joiningFrom ? <span className={metaChip}><CalendarClock aria-hidden="true" className="size-4" />Joining {formatDate(job.joiningFrom)}</span> : null}
              </div>
            </div>
          </div>

          <p className="mt-6 text-lg leading-8 text-ink max-md:mt-4 max-md:text-[15px] max-md:leading-6">{job.summary}</p>

          {match ? <div className="mt-5 md:hidden"><JobMatchRow match={match} /></div> : null}

          <div className="mt-6 grid gap-3 max-md:mt-5 max-md:grid-cols-2 max-md:gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {job.rank ? <div className="rounded-2xl bg-mist-50 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-muted">Rank / role</p><p className="mt-1 font-semibold text-navy-950">{job.rank}</p></div> : null}
            {job.department ? <div className="rounded-2xl bg-mist-50 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-muted">Department</p><p className="mt-1 font-semibold text-navy-950">{job.department}</p></div> : null}
            {job.experienceMinYears !== null ? <div className="rounded-2xl bg-mist-50 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-muted">Experience</p><p className="mt-1 font-semibold text-navy-950">{job.experienceMinYears}+ years</p></div> : null}
            {job.regions.length ? <div className="rounded-2xl bg-mist-50 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-muted">Region</p><p className="mt-1 font-semibold text-navy-950">{job.regions.join(', ')}</p></div> : null}
            {job.applyUntil ? <div className="rounded-2xl bg-mist-50 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-muted">Apply by</p><p className="mt-1 font-semibold text-navy-950">{formatDate(job.applyUntil)}</p></div> : null}
            {job.recruiterVerified ? <div className="rounded-2xl bg-emerald-50 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Recruiter</p><p className="mt-1 inline-flex items-center gap-1 font-semibold text-emerald-900"><BadgeCheck aria-hidden="true" className="size-4" />Verified recruiter</p></div> : null}
          </div>

          {match ? (
            <section aria-labelledby="maritime-match-heading" className="mt-8 overflow-hidden max-md:hidden rounded-[1.5rem] border border-ocean-700/20 bg-mist-50">
              <div className="flex items-center justify-between gap-4 bg-navy-950 px-5 py-4 text-white"><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-white/60">Sea N Shore intelligence</p><h2 id="maritime-match-heading" className="mt-1 text-xl font-semibold">Your Maritime Match</h2></div><div className="text-right"><p className="text-3xl font-bold">{match.score}%</p><p className="text-xs text-white/60">profile fit</p></div></div>
              <div className="grid gap-5 p-5 md:grid-cols-2">
                <div><h3 className="text-sm font-semibold text-navy-950">What matches</h3>{match.reasons.length ? <ul className="mt-3 space-y-2">{match.reasons.map((reason) => <li key={reason} className="flex items-start gap-2 text-sm leading-6 text-ink"><CheckCircle2 aria-hidden="true" className="mt-1 size-4 shrink-0 text-emerald-700" />{reason}</li>)}</ul> : <p className="mt-2 text-sm text-muted">Add more Maritime Passport details to improve match explanations.</p>}</div>
                <div><h3 className="text-sm font-semibold text-navy-950">Check before applying</h3>{match.missingRequirements.length || match.warnings.length ? <ul className="mt-3 space-y-2">{[...match.missingRequirements, ...match.warnings].map((warning) => <li key={warning} className="flex items-start gap-2 text-sm leading-6 text-amber-900"><TriangleAlert aria-hidden="true" className="mt-1 size-4 shrink-0" />{warning}</li>)}</ul> : <p className="mt-2 text-sm font-medium text-emerald-800">No major profile gaps detected.</p>}</div>
              </div>
            </section>
          ) : !profileReady ? <div className="mt-8 rounded-2xl max-md:mt-5 border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">Complete your <Link href="/profile" className="font-semibold underline hover:text-amber-950 hover:decoration-2">Maritime Passport</Link> to see an explainable fit score for this job.</div> : null}

          <div className="mt-8 grid gap-7 border-t border-mist-100 pt-7 max-md:mt-5 max-md:gap-5 max-md:pt-5">
            <section aria-labelledby="job-description-heading"><h2 id="job-description-heading" className="text-xl font-semibold text-navy-950 max-md:text-lg max-md:font-bold">About the role</h2><ClampedText text={job.description} className="mt-3 whitespace-pre-line text-sm leading-7 text-ink max-md:mt-2 max-md:text-[15px] max-md:leading-6" /></section>
            {job.requirements ? <section aria-labelledby="job-requirements-heading"><h2 id="job-requirements-heading" className="text-xl font-semibold text-navy-950">Requirements</h2><p className="mt-3 whitespace-pre-line text-sm leading-7 text-ink">{job.requirements}</p></section> : null}
            {job.certificateRequirements.length ? <section><h2 className="text-xl font-semibold text-navy-950">Certificates</h2><div className="mt-3 flex flex-wrap gap-2">{job.certificateRequirements.map((item) => <span key={item} className="rounded-full bg-mist-100 px-3 py-1 text-sm font-medium text-ink">{item}</span>)}</div></section> : null}
            {job.visaRequirements.length ? <section><h2 className="text-xl font-semibold text-navy-950">Visa requirements</h2><div className="mt-3 flex flex-wrap gap-2">{job.visaRequirements.map((item) => <span key={item} className="rounded-full bg-mist-100 px-3 py-1 text-sm font-medium text-ink">{item}</span>)}</div></section> : null}
          </div>
        </article>

        <aside className="min-w-0 space-y-4 self-start max-md:pb-4 lg:sticky lg:top-20">
          <div className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] max-md:hidden"><p className="text-xs font-semibold uppercase tracking-[.12em] text-ocean-700">Apply with Sea N Shore</p><p className="mt-2 text-sm leading-6 text-muted">Your professional identity and Maritime Passport stay connected to this application.</p><div className="mt-4 flex flex-wrap gap-2">{acceptingApplications || alreadyApplied ? <ApplyJobButton jobId={job.id} alreadyApplied={alreadyApplied} /> : closedNotice}<SaveJobButton jobId={job.id} initialSaved={isSaved} /></div><div className="mt-4 border-t border-mist-100 pt-3"><JobShareActions jobId={job.id} jobTitle={job.title} companyName={job.companyName} /></div></div>
          <section aria-labelledby="job-company-heading" className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
            <h2 id="job-company-heading" className="text-xs font-semibold uppercase tracking-[.12em] text-ocean-700">{job.companyId ? 'Posted by' : 'Posted by a recruiter'}</h2>
            <div className="mt-3">
              <JobCompanyIdentity
                name={job.companyName}
                companyId={job.companyId}
                companySlug={job.companySlug}
                logoPath={job.companyLogoPath}
                location={job.companyLocation ?? null}
                companyType={job.companyType ?? null}
                verified={job.companyVerified}
                personalLabel={job.recruiterVerified ? 'Verified independent recruiter' : 'Independent recruiter'}
              />
            </div>
            {companyHref ? <Link href={companyHref} className={`mt-4 ${secondaryButtonClass}`}>View organization</Link> : null}
          </section>
          <ReportJobButton jobId={job.id} />
          <RailFooter visibleFrom="lg" />
        </aside>
      </div>

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 -mx-4 mt-3 flex items-center gap-2 border-t border-mist-100 bg-white px-4 py-3 shadow-[0_-8px_24px_rgb(7_27_45/0.08)] md:hidden" data-testid="job-apply-bar"><SaveJobButton jobId={job.id} initialSaved={isSaved} variant="bar" />{acceptingApplications || alreadyApplied ? <ApplyJobButton jobId={job.id} alreadyApplied={alreadyApplied} variant="bar" label={job.easyApply ? 'Easy Apply' : 'Apply now'} /> : <span className="flex-1 text-center text-sm font-semibold text-amber-900">Applications closed</span>}</div>
    </section>
  )
}
