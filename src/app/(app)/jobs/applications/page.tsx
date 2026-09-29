import type { Metadata } from 'next'
import Link from 'next/link'
import { CheckCircle2, Circle, ClipboardCheck, MapPin } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { canWithdrawApplication } from '@/features/jobs/application-status'
import { ApplicationRowMenu, WithdrawApplicationButton, type ApplicationRecruiterContact } from '@/features/jobs/components/application-row-menu'
import { ApplicationStatusLine } from '@/features/jobs/components/application-status-line'
import { JobCompanyLogo } from '@/features/jobs/components/job-company-identity'
import { JobsSubnav } from '@/features/jobs/components/jobs-subnav'
import { MyJobsChips } from '@/features/jobs/components/my-jobs-chips'
import { getMyJobApplications } from '@/features/jobs/queries'
import { getRelationshipState } from '@/features/network/queries'
import { JOB_APPLICATION_STATUS_LABELS, type JobApplication, type JobApplicationStatus } from '@/features/jobs/types'

export const metadata: Metadata = { title: 'My applications' }

const statusOrder: JobApplicationStatus[] = ['applied', 'under_review', 'shortlisted', 'interview', 'selected']

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
}

const JOB_STATE_NOTE: Record<'closed' | 'removed', string> = {
  closed: 'This job is no longer taking applications.',
  removed: 'The employer removed this job. Your application is kept here for your records.',
}

function JobTitle({ application }: { application: JobApplication }) {
  const state = application.job.state ?? 'open'
  if (state === 'open') {
    return <Link href={`/jobs/${application.job.id}`} className="text-xl font-semibold text-navy-950 hover:text-ocean-700 hover:underline">{application.job.title}</Link>
  }
  return <p className="text-xl font-semibold text-navy-950">{application.job.title}</p>
}

/**
 * Who the applicant can message about each application. Messaging is limited to accepted
 * connections (messaging service rule), so the phone sheet disables the row otherwise.
 */
async function recruiterContacts(applications: JobApplication[]) {
  const ids = [...new Set(applications.map((application) => application.job.recruiterProfileId).filter((id): id is string => Boolean(id)))]
  const entries = await Promise.all(ids.map(async (id) => {
    try {
      const relationship = await getRelationshipState(id)
      return [id, relationship.connection.kind === 'connected'] as const
    } catch {
      return [id, false] as const
    }
  }))
  return new Map(entries)
}

export default async function JobApplicationsPage() {
  const applications = await getMyJobApplications()
  const contacts = await recruiterContacts(applications)
  const recruiterFor = (application: JobApplication): ApplicationRecruiterContact | null => {
    const id = application.job.recruiterProfileId
    return id ? { profileId: id, canMessage: contacts.get(id) ?? false } : null
  }
  return (
    <section className="pb-2 pt-0 md:py-5">
      <MobilePageBar backHref="/jobs" title="My jobs" />
      <MyJobsChips active="applications" />
      <div className="rounded-[1.75rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] max-md:hidden sm:p-8"><div className="flex items-start gap-4"><div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-navy-950 text-white"><ClipboardCheck aria-hidden="true" className="size-5" /></div><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Jobs workspace</p><h1 className="mt-1 text-3xl font-semibold tracking-[-.035em] text-navy-950">My Applications</h1><p className="mt-2 max-w-2xl text-sm leading-7 text-muted">Follow each maritime application from submission through review, shortlist, interview and final decision.</p></div></div></div>
      <JobsSubnav active="applications" className="max-md:hidden" />

      {applications.length ? (
        <ul aria-label="Your applications" className="-mx-4 divide-y divide-mist-100 border-y border-mist-100 bg-white md:hidden">
          {applications.map((application) => {
            const state = application.job.state ?? 'open'
            return (
              <li key={application.id} className="relative flex gap-3 px-4 py-3.5">
                <JobCompanyLogo name={application.job.companyName} companyId={application.job.companyId ?? null} logoPath={application.job.companyLogoPath ?? null} size="md" />
                <div className="min-w-0 flex-1">
                  {state === 'open' ? (
                    <Link href={`/jobs/${application.job.id}`} className="line-clamp-2 text-[15px] font-semibold leading-5 text-ocean-700 after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ocean-500">{application.job.title}</Link>
                  ) : (
                    <p className="line-clamp-2 text-[15px] font-semibold leading-5 text-navy-950">{application.job.title}</p>
                  )}
                  <p className="mt-0.5 truncate text-sm text-ink">{application.job.companyName}</p>
                  <ApplicationStatusLine status={application.status} updatedAt={application.updatedAt} />
                  {state !== 'open' ? <p className="mt-1 text-[13px] text-amber-900">{JOB_STATE_NOTE[state]}</p> : null}
                </div>
                <ApplicationRowMenu
                  applicationId={application.id}
                  jobId={application.job.id}
                  jobTitle={application.job.title}
                  jobOpen={state === 'open'}
                  canWithdraw={canWithdrawApplication(application.status)}
                  recruiter={recruiterFor(application)}
                  appliedAt={application.appliedAt}
                  events={application.events ?? []}
                  coverNote={application.coverNote ?? null}
                />
              </li>
            )
          })}
        </ul>
      ) : null}

      {applications.length ? <div className="mt-5 space-y-4 max-md:hidden">{applications.map((application) => {
        const currentIndex = statusOrder.indexOf(application.status)
        return <article key={application.id} className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><JobTitle application={application} /><p className="mt-1 text-sm text-muted">{application.job.companyName}</p>{application.job.state && application.job.state !== 'open' ? <p className="mt-2 text-xs font-semibold text-amber-900">{JOB_STATE_NOTE[application.job.state]}</p> : null}{application.job.location ? <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted"><MapPin aria-hidden="true" className="size-3.5" />{application.job.location}</p> : null}</div><span className="self-start rounded-full bg-mist-50 px-3 py-1.5 text-xs font-semibold text-ocean-700">{JOB_APPLICATION_STATUS_LABELS[application.status]}</span></div>

          {application.coverNote ? <div className="mt-4 rounded-xl bg-mist-50 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted">Your message to the employer</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink">{application.coverNote}</p></div> : null}

          {canWithdrawApplication(application.status) ? <div className="mt-4"><WithdrawApplicationButton applicationId={application.id} jobTitle={application.job.title} /></div> : null}

          <section className="mt-5 border-t border-mist-100 pt-5" aria-label="Application timeline"><div className="mb-3 flex items-center justify-between gap-3"><h2 className="font-semibold text-navy-950">Application timeline</h2><span className="text-xs text-muted">Applied {formatDate(application.appliedAt)}</span></div>
            {application.events?.length ? <ol className="space-y-3">{application.events.map((event, index) => <li key={event.id} className="flex gap-3"><div className="flex flex-col items-center"><CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-ocean-700" />{index < (application.events?.length ?? 0) - 1 ? <span className="mt-1 h-full min-h-5 w-px bg-mist-100" /> : null}</div><div className="pb-2"><p className="text-sm font-semibold text-navy-950">{JOB_APPLICATION_STATUS_LABELS[event.status]}</p><p className="mt-0.5 text-xs text-muted">{formatDate(event.createdAt)}</p>{event.note ? <p className="mt-1 text-sm leading-6 text-ink">{event.note}</p> : null}</div></li>)}</ol> : <ol className="grid gap-2 sm:grid-cols-5">{statusOrder.map((status, index) => { const completed = currentIndex >= index && currentIndex !== -1; return <li key={status} className={completed ? 'rounded-xl bg-mist-50 p-3 text-xs font-semibold text-navy-950' : 'rounded-xl border border-dashed border-mist-100 p-3 text-xs font-medium text-muted'}>{completed ? <CheckCircle2 aria-hidden="true" className="mb-2 size-4 text-ocean-700" /> : <Circle aria-hidden="true" className="mb-2 size-4" />}{JOB_APPLICATION_STATUS_LABELS[status]}</li> })}</ol>}
          </section>
        </article>
      })}</div> : <div className="mt-5 rounded-[1.5rem] border border-dashed max-md:mt-2 border-mist-100 bg-white px-6 py-12 text-center"><p className="font-semibold text-navy-950">You have not applied for a role yet.</p><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">When you use Easy Apply, your application and every status change will appear here.</p><Link href="/jobs" className="mt-4 inline-flex min-h-10 items-center rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-navy-800 transition-colors">Explore jobs</Link></div>}
    </section>
  )
}
