import type { JobSearchFilters } from './types'
import { departmentByKey, roleByKey } from '@/features/roles/taxonomy'

/** A filter currently applied to job discovery, keyed by its URL parameter. */
export type ActiveJobFilter = { key: string; label: string }

/**
 * Filters shown as removable chips (desktop filter panel and the phone results header).
 * Discovery modes (For You, Sea, Shore, Urgent, Recent) are chips of their own and are not listed here.
 */
export function activeJobFilters(filters: JobSearchFilters): ActiveJobFilter[] {
  return [
    ...(filters.department ? [{ key: 'department', label: departmentByKey(filters.department)?.label ?? filters.department }] : []),
    ...filters.ranks.map((value) => ({ key: 'rank', label: roleByKey(value)?.label ?? value })),
    ...filters.vesselTypes.map((value) => ({ key: 'vessel', label: value })),
    ...filters.regions.map((value) => ({ key: 'region', label: value })),
    ...filters.certificates.map((value) => ({ key: 'certificate', label: value })),
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
  { value: 'best', label: 'Best match' },
  { value: 'recent', label: 'Newest first' },
  { value: 'joining', label: 'Joining soonest' },
  { value: 'salary', label: 'Highest salary' },
] as const

export const JOB_JOINING_WINDOWS = [7, 14, 30, 60] as const

/**
 * Bug fix (13 Nov): the href of a discovery chip (For You, Sea Jobs, Urgent Joining, Recently Posted…). It keeps
 * the current search words, filters and sort, so a chip combines with them, and starts again at page 1. A link
 * (not a replace), so Back returns to the chip before.
 */
export function jobModeHref(current: URLSearchParams | string, mode: string) {
  const params = new URLSearchParams(typeof current === 'string' ? current : current.toString())
  params.delete('page')
  params.set('mode', mode)
  return `/jobs?${params.toString()}`
}
