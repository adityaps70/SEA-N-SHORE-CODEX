import type { JobListing } from './types'

export type PublicJobFeedEntry = {
  id: string
  title: string
  company: string
  location: string | null
  rank: string | null
  vessel_type: string | null
  experience: string | null
  salary: string | null
  joining_date: string | null
  expires_at: string | null
  status: 'published'
  public_url: string
}

function salaryDescription(job: JobListing): string | null {
  if (job.salaryMin === null && job.salaryMax === null) return null
  const currency = job.salaryCurrency?.trim() || ''
  const low = job.salaryMin?.toLocaleString('en-US')
  const high = job.salaryMax?.toLocaleString('en-US')
  const amount = low && high && low !== high ? low + '–' + high : (low ?? high)
  return [currency, amount, job.salaryPeriod ? '/ ' + job.salaryPeriod : '']
    .filter(Boolean)
    .join(' ')
}

export function mapPublicJobsFeed(jobs: readonly JobListing[], now = new Date()): PublicJobFeedEntry[] {
  const today = now.toISOString().slice(0, 10)

  return jobs
    .filter((job) => !job.applyUntil || job.applyUntil >= today)
    .slice(0, 24)
    .map((job) => ({
      id: job.id,
      title: job.title,
      company: job.companyName,
      location: job.location,
      rank: job.rank,
      vessel_type: job.vesselTypes[0] ?? null,
      experience: job.experienceMinYears === null ? null : job.experienceMinYears + ' years',
      salary: salaryDescription(job),
      joining_date: job.joiningFrom,
      expires_at: job.applyUntil,
      status: 'published' as const,
      public_url: 'https://seanshore.in/jobs/' + encodeURIComponent(job.id),
    }))
}
