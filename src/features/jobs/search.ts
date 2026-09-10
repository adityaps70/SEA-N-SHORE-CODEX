import { JOB_DISCOVERY_MODES, type JobDiscoveryMode } from './catalog'
import type { JobSearchFilters, JobSort } from './types'

type SearchParamValue = string | string[] | undefined
type JobSearchParams = Record<string, SearchParamValue>

const DISCOVERY_MODES = new Set<JobDiscoveryMode>(JOB_DISCOVERY_MODES.map((mode) => mode.value))
const SORTS = new Set<JobSort>(['recommended', 'recent', 'joining', 'salary'])

function first(value: SearchParamValue): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ''
}

function list(value: SearchParamValue): string[] {
  const values = Array.isArray(value) ? value : [value]
  return [...new Set(values.flatMap((item) => (item ?? '').split(',')).map((item) => item.trim()).filter(Boolean))].slice(0, 20)
}

function numberOrNull(value: SearchParamValue, options: { allowZero?: boolean; max?: number } = {}): number | null {
  const raw = first(value)
  if (!raw) return null
  const parsed = Number(raw)
  const minimum = options.allowZero ? 0 : Number.MIN_VALUE
  if (!Number.isFinite(parsed) || parsed < minimum || (options.max !== undefined && parsed > options.max)) return null
  return parsed
}

function flag(value: SearchParamValue): boolean {
  return ['1', 'true', 'yes', 'on'].includes(first(value).toLowerCase())
}

export function parseJobSearchParams(params: JobSearchParams): JobSearchFilters {
  const requestedMode = first(params.mode) as JobDiscoveryMode
  const mode = DISCOVERY_MODES.has(requestedMode) ? requestedMode : 'for-you'
  const requestedSort = first(params.sort) as JobSort

  const filters: JobSearchFilters = {
    query: first(params.q),
    mode,
    ranks: list(params.rank),
    vesselTypes: list(params.vessel),
    minExperienceYears: numberOrNull(params.experience, { allowZero: true, max: 70 }),
    joiningWithinDays: numberOrNull(params.joining, { max: 365 }),
    salaryMin: numberOrNull(params.salaryMin, { allowZero: true }),
    salaryMax: numberOrNull(params.salaryMax, { allowZero: true }),
    regions: list(params.region),
    certificates: list(params.certificate),
    visas: list(params.visa),
    verifiedOnly: flag(params.verified),
    urgentOnly: flag(params.urgent),
    easyApplyOnly: flag(params.easyApply),
    postedWithinDays: numberOrNull(params.postedWithin, { max: 365 }),
    sort: SORTS.has(requestedSort) ? requestedSort : 'recommended',
  }

  if (mode === 'urgent') filters.urgentOnly = true
  if (mode === 'recent' && filters.postedWithinDays === null) filters.postedWithinDays = 7

  return filters
}
