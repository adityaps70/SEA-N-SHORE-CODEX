import Link from '@/components/navigation/intent-link'
import { relativeTimeFrom } from '@/lib/relative-time'
import { formatSalaryRange } from '../salary'
import type { JobListing } from '../types'
import { JobCompanyLogo } from './job-company-identity'

/** Round H (H7): up to 4 live jobs like this one, as compact cards under the job page. */
export function SimilarJobs({ jobs, signedOut = false }: { jobs: readonly JobListing[]; signedOut?: boolean }) {
  if (!jobs.length) return null
  return (
    <section aria-labelledby="similar-jobs-heading" className="mt-6 max-md:mt-2">
      <h2 id="similar-jobs-heading" className="text-xl font-semibold text-navy-950 max-md:text-lg max-md:font-bold">Similar jobs</h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {jobs.map((job) => {
          const salary = formatSalaryRange(job)
          const age = relativeTimeFrom(job.publishedAt ?? job.createdAt)
          const details = [job.location, salary].filter(Boolean).join(' · ')
          return (
            <li key={job.id} className="relative flex min-w-0 gap-3 rounded-2xl border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)] hover:border-ocean-200">
              {/* The logo route serves signed-in members only, so visitors see initials (as on job cards). */}
              <JobCompanyLogo name={job.companyName} companyId={job.companyId} logoPath={signedOut && !job.companyVerified ? null : job.companyLogoPath} size="sm" />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/jobs/${job.id}`}
                  className="line-clamp-2 font-semibold leading-5 text-navy-950 after:absolute after:inset-0 after:rounded-2xl after:content-[''] hover:text-ocean-700 hover:underline focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ocean-600"
                >
                  {job.title}
                </Link>
                <p className="mt-0.5 truncate text-sm text-ink">{job.companyName}</p>
                {details ? <p className="mt-0.5 line-clamp-2 text-[13px] text-muted">{details}</p> : null}
                {age ? <p className="mt-1 text-[13px] text-muted">Posted {age}{/^\d+[mhd]$/.test(age) ? ' ago' : ''}</p> : null}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
