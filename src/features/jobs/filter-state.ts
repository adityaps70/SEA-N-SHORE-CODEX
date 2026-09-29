import type { JobSearchFilters } from './types'

/** A filter currently applied to job discovery, keyed by its URL parameter. */
export type ActiveJobFilter = { key: string; label: string }

/**
 * Filters shown as removable chips (desktop filter panel and the phone results header).
 * Discovery modes (For You, Sea, Shore, Urgent, Recent) are chips of their own and are not listed here.
 */
export function activeJobFilters(filters: JobSearchFilters): ActiveJobFilter[] {
  return [
    ...filters.ranks.map((value) => ({ key: 'rank', label: value })),
    ...filters.vesselTypes.map((value) => ({ key: 'vessel', label: value })),
    ...filters.regions.map((value) => ({ key: 'region', label: value })),
    ...filters.certificates.map((value) => ({ key: 'certificate', label: value })),
    ...filters.visas.map((value) => ({ key: 'visa', label: value })),
    ...(filters.minExperienceYears !== null ? [{ key: 'experience', label: `${filters.minExperienceYears}+ years` }] : []),
    ...(filters.joiningWithinDays !== null ? [{ key: 'joining', label: `Join ≤ ${filters.joiningWithinDays} days` }] : []),
    ...(filters.salaryMin !== null ? [{ key: 'salaryMin', label: `Salary ≥ ${filters.salaryMin}` }] : []),
    ...(filters.verifiedOnly ? [{ key: 'verified', label: 'Verified employers' }] : []),
    ...(filters.easyApplyOnly ? [{ key: 'easyApply', label: 'Easy Apply' }] : []),
  ]
}

/** Sort options, in the order both the desktop select and the phone sheet show them. */
export const JOB_SORT_OPTIONS = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'recent', label: 'Newest' },
  { value: 'joining', label: 'Joining soonest' },
  { value: 'salary', label: 'Highest salary' },
] as const

export const JOB_JOINING_WINDOWS = [7, 14, 30, 60] as const
