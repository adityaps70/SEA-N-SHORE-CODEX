import type { Metadata } from 'next'
import { organizationLogoUrl } from '@/features/organizations/organization-page-profile'
import { indexableMetadata, metaDescription, plainText } from '@/lib/seo/meta'
import { jobClosedReason } from './job-lifecycle'
import type { JobListing } from './types'

/**
 * Round H (H5): search metadata and schema.org JobPosting data for the public jobs list and job pages.
 *
 * - The jobs list and live job pages are indexable, with a canonical address and a plain-text description.
 * - A published job past its apply-by date or joining window stays readable but carries noindex, and its
 *   JobPosting keeps a validThrough in the past. Closed and deleted jobs are not found (404): Next.js 16
 *   pages cannot answer 410 Gone (only notFound / forbidden / unauthorized), and a 404 drops the page from
 *   search all the same.
 * - employmentType: jobs have no employment-type field. Sea jobs are fixed-term contracts (one voyage or
 *   tour of duty), so TEMPORARY; shore jobs are FULL_TIME.
 */

export const JOBS_INDEX_PATH = '/jobs'
export const JOBS_INDEX_TITLE = 'Maritime jobs'
export const JOBS_INDEX_DESCRIPTION = 'Live sea and shore jobs from maritime employers and recruiters: officers, engineers, ratings, cadets and shore roles, with salary and joining dates.'

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Job ids are UUIDs; anything else is not a job page (and never reaches the database). */
export function isJobId(value: string) {
  return JOB_ID.test(value)
}

export function jobPath(id: string) {
  return `/jobs/${id}`
}

export function jobsIndexMetadata(): Metadata {
  return indexableMetadata({ title: JOBS_INDEX_TITLE, description: metaDescription(JOBS_INDEX_DESCRIPTION), path: JOBS_INDEX_PATH })
}

export function jobMetaDescription(job: Pick<JobListing, 'summary' | 'description'>) {
  return metaDescription(job.summary, job.description)
}

/** Title, description and canonical for a job page; noindex once the job no longer takes applications. */
export function jobMetadata(job: JobListing, today: string): Metadata {
  const metadata = indexableMetadata({ title: `${job.title} at ${job.companyName}`, description: jobMetaDescription(job), path: jobPath(job.id) })
  return jobClosedReason(job, today) ? { ...metadata, robots: { index: false, follow: true } } : metadata
}

/** The last day the job takes applications: the earlier of the apply-by date and the joining window end. */
export function jobLastDay(job: Pick<JobListing, 'applyUntil' | 'joiningFrom' | 'joiningUntil'>) {
  const joiningEnd = job.joiningUntil ?? job.joiningFrom
  if (job.applyUntil && joiningEnd) return job.applyUntil < joiningEnd ? job.applyUntil : joiningEnd
  return job.applyUntil ?? joiningEnd
}

const REMOTE = /\b(?:remote|work from home|wfh|telecommute|anywhere)\b/i
const WORLDWIDE = /^(?:worldwide|world wide|global|various|international|onboard|on board|at sea)$/i
const COUNTRY_ALIASES: Record<string, string> = { uae: 'AE', usa: 'US', us: 'US', uk: 'GB', 'great britain': 'GB', england: 'GB', scotland: 'GB', 'south korea': 'KR', korea: 'KR', russia: 'RU', vietnam: 'VN', holland: 'NL' }

let countryCodes: Map<string, string> | null = null

/** English country name (or common short form) → ISO 3166-1 alpha-2 code, from the runtime's region names. */
export function countryCode(name: string): string | null {
  const key = name.trim().toLowerCase()
  if (!key) return null
  if (COUNTRY_ALIASES[key]) return COUNTRY_ALIASES[key]
  if (!countryCodes) {
    countryCodes = new Map()
    const names = new Intl.DisplayNames(['en'], { type: 'region' })
    for (let first = 65; first <= 90; first += 1) {
      for (let second = 65; second <= 90; second += 1) {
        const code = String.fromCharCode(first, second)
        try {
          const label = names.of(code)
          if (label && label !== code && !countryCodes.has(label.toLowerCase())) countryCodes.set(label.toLowerCase(), code)
        } catch {
          // Not a region code.
        }
      }
    }
  }
  return countryCodes.get(key) ?? null
}

type PostalAddress = { '@type': 'PostalAddress'; addressLocality?: string; addressCountry?: string }

/** "Mumbai, India" → locality Mumbai, country IN. A single unknown place is a locality. */
export function postalAddress(location: string): PostalAddress | null {
  const parts = location.split(',').map((part) => part.trim()).filter(Boolean)
  if (!parts.length) return null
  const last = parts[parts.length - 1]!
  const code = countryCode(last)
  if (code) {
    const locality = parts.slice(0, -1).join(', ')
    return { '@type': 'PostalAddress', ...(locality ? { addressLocality: locality } : {}), addressCountry: code }
  }
  if (parts.length > 1) return { '@type': 'PostalAddress', addressLocality: parts.slice(0, -1).join(', '), addressCountry: last }
  return { '@type': 'PostalAddress', addressLocality: last }
}

function locationFields(job: JobListing): Record<string, unknown> {
  const location = job.location?.trim() ?? ''
  const remote = REMOTE.test(location)
  const address = !remote && !WORLDWIDE.test(location) && location ? postalAddress(location) : null
  if (address) return { jobLocation: { '@type': 'Place', address } }
  // Round H (H5): Google keeps TELECOMMUTE for fully remote work. A "Worldwide" or onboard sea job (and a job that
  // names no place) is listed at the employer's office; only an explicitly remote job, or one with no office to
  // name, is a remote role.
  const office = !remote && job.companyLocation ? postalAddress(job.companyLocation) : null
  if (office) return { jobLocation: { '@type': 'Place', address: office } }
  const countries = [...new Set(job.regions.map((region) => region.trim()).filter((region) => countryCode(region)))]
  return {
    jobLocationType: 'TELECOMMUTE',
    ...(countries.length ? { applicantLocationRequirements: countries.map((name) => ({ '@type': 'Country', name })) } : {}),
  }
}

const SALARY_UNITS = { day: 'DAY', month: 'MONTH', year: 'YEAR' } as const

function baseSalary(job: JobListing) {
  if (job.salaryMin === null && job.salaryMax === null) return null
  const unitText = job.salaryPeriod ? SALARY_UNITS[job.salaryPeriod] : undefined
  const amount = job.salaryMin !== null && job.salaryMax !== null && job.salaryMin !== job.salaryMax
    ? { minValue: Math.min(job.salaryMin, job.salaryMax), maxValue: Math.max(job.salaryMin, job.salaryMax) }
    : { value: job.salaryMin ?? job.salaryMax }
  return {
    '@type': 'MonetaryAmount',
    currency: job.salaryCurrency ?? 'USD',
    value: { '@type': 'QuantitativeValue', ...amount, ...(unitText ? { unitText } : {}) },
  }
}

/** schema.org JobPosting for a job page. `origin` is the public site origin (absolute URLs). */
export function jobPostingJsonLd(job: JobListing, origin: string): Record<string, unknown> {
  const description = [job.summary, job.description, job.requirements].map(plainText).filter(Boolean)
  const lastDay = jobLastDay(job)
  // Round H (H5): only a verified organization's logo is public (see /api/company-logo).
  const logo = job.companyId && job.companyVerified ? organizationLogoUrl({ id: job.companyId, logoPath: job.companyLogoPath ?? null }) : null
  const salary = baseSalary(job)
  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description: [...new Set(description)].join('\n\n'),
    datePosted: job.publishedAt ?? job.createdAt,
    ...(lastDay ? { validThrough: `${lastDay}T23:59:59Z` } : {}),
    employmentType: job.domain === 'sea' ? 'TEMPORARY' : 'FULL_TIME',
    hiringOrganization: {
      '@type': 'Organization',
      name: job.companyName,
      ...(job.companyId && job.companySlug ? { sameAs: `${origin}/organizations/${job.companySlug}` } : {}),
      ...(logo ? { logo: `${origin}${logo}` } : {}),
    },
    ...locationFields(job),
    ...(salary ? { baseSalary: salary } : {}),
    ...(job.easyApply ? { directApply: true } : {}),
    identifier: { '@type': 'PropertyValue', name: 'Sea N Shore', value: job.id },
    url: `${origin}${jobPath(job.id)}`,
  }
}
