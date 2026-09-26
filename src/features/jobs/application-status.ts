import type { JobApplicationStatus } from './types'

/**
 * Owner-facing application stages. They map onto the existing job_application_status values,
 * so no data migration is needed:
 *   applied → New, under_review → Reviewed, shortlisted → Shortlisted, interview → Interview,
 *   selected → Hired, rejected → Rejected, withdrawn → Withdrawn (set by the applicant only).
 * Applicants see their own wording from JOB_APPLICATION_STATUS_LABELS in ./types.
 */
export const HIRING_APPLICATION_STATUS_LABELS: Record<JobApplicationStatus, string> = {
  applied: 'New',
  under_review: 'Reviewed',
  shortlisted: 'Shortlisted',
  interview: 'Interview',
  selected: 'Hired',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
}

export const HIRING_APPLICATION_STATUS_BADGES: Record<JobApplicationStatus, string> = {
  applied: 'bg-ocean-50 text-ocean-800',
  under_review: 'bg-mist-100 text-navy-900',
  shortlisted: 'bg-emerald-50 text-emerald-800',
  interview: 'bg-teal-50 text-teal-800',
  selected: 'bg-navy-950 text-white',
  rejected: 'bg-rose-50 text-rose-800',
  withdrawn: 'bg-mist-100 text-muted',
}

/** Pipeline order for filters and counts. */
export const HIRING_PIPELINE_STATUSES: readonly JobApplicationStatus[] = [
  'applied',
  'under_review',
  'shortlisted',
  'interview',
  'selected',
  'rejected',
  'withdrawn',
]

export const OWNER_SETTABLE_APPLICATION_STATUSES = [
  'under_review',
  'shortlisted',
  'interview',
  'selected',
  'rejected',
] as const satisfies readonly JobApplicationStatus[]

export type OwnerSettableApplicationStatus = (typeof OWNER_SETTABLE_APPLICATION_STATUSES)[number]

export function isOwnerSettableApplicationStatus(value: string): value is OwnerSettableApplicationStatus {
  return (OWNER_SETTABLE_APPLICATION_STATUSES as readonly string[]).includes(value)
}

export function validateApplicationStatusChange(
  current: JobApplicationStatus,
  next: JobApplicationStatus,
): { ok: true } | { ok: false; message: string } {
  if (current === 'withdrawn') {
    return { ok: false, message: 'This applicant withdrew their application, so its status can no longer be changed.' }
  }
  if (!isOwnerSettableApplicationStatus(next)) {
    return { ok: false, message: 'Choose Reviewed, Shortlisted, Interview, Hired or Rejected.' }
  }
  if (current === next) {
    return { ok: false, message: `This application is already marked ${HIRING_APPLICATION_STATUS_LABELS[next]}.` }
  }
  return { ok: true }
}
