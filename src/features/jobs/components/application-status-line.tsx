import { relativeTimeFrom } from '@/lib/relative-time'
import { JOB_APPLICATION_STATUS_LABELS, type JobApplicationStatus } from '../types'

/** Applicant-facing status colours: dot + text, our tokens only. */
const STATUS_TONE: Record<JobApplicationStatus, { dot: string; text: string }> = {
  applied: { dot: 'bg-navy-300', text: 'text-navy-700' },
  under_review: { dot: 'bg-ocean-700', text: 'text-ocean-700' },
  shortlisted: { dot: 'bg-teal-500', text: 'text-ocean-800' },
  interview: { dot: 'bg-teal-500', text: 'text-ocean-800' },
  selected: { dot: 'bg-navy-950', text: 'text-navy-950' },
  rejected: { dot: 'bg-red-600', text: 'text-red-700' },
  withdrawn: { dot: 'bg-mist-300', text: 'text-muted' },
}

/** One status line per application on phones: "● Under review · 2d". */
export function ApplicationStatusLine({ status, updatedAt }: { status: JobApplicationStatus; updatedAt: string }) {
  const tone = STATUS_TONE[status]
  const age = relativeTimeFrom(updatedAt)
  return (
    <p className={`mt-1 flex items-center gap-1.5 text-[13px] font-semibold ${tone.text}`} data-status={status}>
      <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${tone.dot}`} />
      <span>{JOB_APPLICATION_STATUS_LABELS[status]}</span>
      {age ? <><span aria-hidden="true">·</span><span className="font-medium">{age}</span></> : null}
    </p>
  )
}
