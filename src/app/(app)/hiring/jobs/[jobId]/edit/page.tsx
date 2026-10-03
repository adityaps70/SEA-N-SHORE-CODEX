import type { Metadata } from 'next'
import Link from 'next/link'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { notFound } from 'next/navigation'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { HiringJobForm } from '@/features/jobs/components/hiring-job-form'
import { HiringJobLifecycleActions } from '@/features/jobs/components/hiring-job-lifecycle-actions'
import { HiringSubnav } from '@/features/jobs/components/hiring-subnav'
import { JobCompanyIdentity } from '@/features/jobs/components/job-company-identity'
import { hiringRepository, managedJobLifecycle } from '@/features/jobs/hiring-repository'
import { availableJobActions, jobStatusPresentation, todayIsoDate } from '@/features/jobs/job-lifecycle'

export const metadata: Metadata = { title: 'Edit job' }

export default async function EditHiringJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params
  const user = await requireAwsUser()
  const managedJobs = await hiringRepository.listManagedJobs(user.id)
  const jobSummary = managedJobs.find((item) => item.id === jobId)
  if (!jobSummary) notFound()

  const job = await hiringRepository.getEditableJob(user.id, jobSummary.companyId, jobId)
  if (!job) notFound()

  const today = todayIsoDate()
  const lifecycle = managedJobLifecycle(jobSummary)
  const presentation = jobStatusPresentation(lifecycle, today)
  const actions = availableJobActions(lifecycle)
  const publishLabel = actions.includes('publish')
    ? 'Save and publish'
    : actions.includes('republish') ? 'Save and republish' : null

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 pb-4 pt-0 max-md:space-y-4 md:px-6 md:py-8 lg:px-8">
      <MobilePageBar backHref="/hiring/jobs" title="Edit vacancy" />
      <div className="max-md:hidden">
        <JobCompanyIdentity
          name={jobSummary.publisherName}
          companyId={jobSummary.companyId}
          companySlug={jobSummary.companySlug}
          logoPath={jobSummary.companyLogoPath}
          location={jobSummary.companyLocation}
          verified={jobSummary.companyVerified}
          size="sm"
          personalLabel="Personal recruiter"
        />
        <h1 className="mt-4 text-3xl font-bold text-navy-950">Edit vacancy</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Update the structured role requirements without changing the publishing identity attached to this vacancy.
        </p>
      </div>
      <div className="max-md:hidden"><HiringSubnav active="jobs" /></div>

      <section aria-labelledby="job-status-heading" className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] max-md:rounded-2xl max-md:p-4 max-md:shadow-none sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Job status</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 id="job-status-heading" className="text-xl font-bold text-navy-950">{job.title}</h2>
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${presentation.badgeClassName}`}>{presentation.label}</span>
            </div>
            <p className="mt-1 text-sm text-muted">{presentation.description}</p>
          </div>
          <Link href={`/hiring/jobs/${jobId}/applicants`} className="inline-flex min-h-10 shrink-0 items-center self-start rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-950 hover:bg-mist-50">
            {jobSummary.applicantCount} applicant{jobSummary.applicantCount === 1 ? '' : 's'}
          </Link>
        </div>
        <div className="mt-4">
          <HiringJobLifecycleActions jobId={jobId} jobTitle={job.title} lifecycle={lifecycle} today={today} />
        </div>
      </section>

      <HiringJobForm mode="edit" jobId={jobId} initial={job} publishLabel={publishLabel} />
    </div>
  )
}
