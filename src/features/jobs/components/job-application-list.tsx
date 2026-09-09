import Link from 'next/link'
import { ArrowRight, BriefcaseBusiness, Clock3, MapPin } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { JOB_APPLICATION_STATUS_LABELS, type JobApplication } from '../types'

function formatAppliedAt(value: string) {
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
}

export function JobApplicationList({ applications }: { applications: JobApplication[] }) {
  if (!applications.length) {
    return (
      <div className="rounded-[1.5rem] border border-dashed border-mist-100 bg-white px-6 py-10 text-center">
        <p className="font-semibold text-navy-950">You have not applied for a role yet.</p>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">Explore current maritime opportunities and your applications will appear here with their latest status.</p>
        <Link href="/jobs" className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white">
          Explore jobs <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {applications.map((application) => (
        <Card key={application.id} className="border border-mist-100 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-mist-50 text-navy-950">
              <BriefcaseBusiness aria-hidden="true" className="size-4.5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link href={`/jobs/${application.job.id}`} className="font-semibold text-navy-950 hover:text-ocean-700">
                    {application.job.title}
                  </Link>
                  <p className="mt-0.5 text-sm text-muted">{application.job.companyName}</p>
                </div>
                <span className="rounded-full bg-mist-50 px-3 py-1 text-xs font-semibold text-ocean-700">
                  {JOB_APPLICATION_STATUS_LABELS[application.status]}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs font-medium text-muted">
                {application.job.location ? (
                  <span className="inline-flex items-center gap-1.5"><MapPin aria-hidden="true" className="size-3.5" />{application.job.location}</span>
                ) : null}
                <span className="inline-flex items-center gap-1.5"><Clock3 aria-hidden="true" className="size-3.5" />Applied {formatAppliedAt(application.appliedAt)}</span>
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
