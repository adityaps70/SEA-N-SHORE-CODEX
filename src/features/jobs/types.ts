import type { JobDiscoveryMode } from './catalog'

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

export type JobDomain = 'sea' | 'shore'
export type JobSalaryPeriod = 'day' | 'month' | 'year'
export type JobSort = 'recommended' | 'recent' | 'joining' | 'salary'

export type JobSearchFilters = {
  query: string
  mode: JobDiscoveryMode
  ranks: string[]
  vesselTypes: string[]
  minExperienceYears: number | null
  joiningWithinDays: number | null
  salaryMin: number | null
  salaryMax: number | null
  regions: string[]
  certificates: string[]
  visas: string[]
  verifiedOnly: boolean
  urgentOnly: boolean
  easyApplyOnly: boolean
  postedWithinDays: number | null
  sort: JobSort
}

export type JobCredential = {
  name: string
  expiresAt: string | null
  verified: boolean
}

export type JobCandidateProfile = {
  rank: string | null
  sailingExperienceYears: number | null
  vesselTypes: string[]
  tradingAreas: string[]
  availability: string | null
  certificates: JobCredential[]
  visas: string[]
  shoreCareerPreference: boolean
  skills: string[]
}

export type JobMatchResult = {
  score: number
  reasons: string[]
  missingRequirements: string[]
  warnings: string[]
}

export type JobListing = {
  id: string
  title: string
  companyName: string
  companyId: string | null
  companySlug: string | null
  companyVerified: boolean
  recruiterVerified: boolean
  location: string | null
  summary: string
  description: string
  requirements: string | null
  applyUntil: string | null
  createdAt: string
  publishedAt: string | null
  domain: JobDomain
  department: string | null
  rank: string | null
  vesselTypes: string[]
  experienceMinYears: number | null
  experienceMaxYears: number | null
  joiningFrom: string | null
  joiningUntil: string | null
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  salaryPeriod: JobSalaryPeriod | null
  regions: string[]
  certificateRequirements: string[]
  visaRequirements: string[]
  urgent: boolean
  easyApply: boolean
}

export type JobApplicationEvent = {
  id: string
  status: JobApplicationStatus
  note: string | null
  createdAt: string
}

export type JobApplication = {
  id: string
  status: JobApplicationStatus
  appliedAt: string
  updatedAt: string
  events?: JobApplicationEvent[]
  job: Pick<JobListing, 'id' | 'title' | 'companyName' | 'location'>
}

export type JobAlert = {
  id: string
  name: string
  filters: JobSearchFilters
  frequency: 'instant' | 'daily' | 'weekly'
  enabled: boolean
  createdAt: string
}
