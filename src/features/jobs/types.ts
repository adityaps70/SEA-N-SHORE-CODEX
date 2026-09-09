export const JOB_APPLICATION_STATUSES = [
  'applied',
  'under_review',
  'shortlisted',
  'interview',
  'selected',
  'rejected',
  'withdrawn',
] as const

export type JobApplicationStatus = (typeof JOB_APPLICATION_STATUSES)[number]

export const JOB_APPLICATION_STATUS_LABELS: Record<JobApplicationStatus, string> = {
  applied: 'Applied',
  under_review: 'Under review',
  shortlisted: 'Shortlisted',
  interview: 'Interview',
  selected: 'Selected',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
}

export type JobListing = {
  id: string
  title: string
  companyName: string
  location: string | null
  summary: string
  description: string
  requirements: string | null
  applyUntil: string | null
  createdAt: string
}

export type JobApplication = {
  id: string
  status: JobApplicationStatus
  appliedAt: string
  updatedAt: string
  job: Pick<JobListing, 'id' | 'title' | 'companyName' | 'location'>
}
