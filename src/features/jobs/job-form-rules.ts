import { normaliseLegacyRank, roleByKey } from '@/features/roles/taxonomy'
import { locationKind } from './job-location'

/**
 * Round H (H7): the job form's checks, shared by the form (as you type and before saving) and, once
 * wired, the server actions. Errors block saving; warnings are shown but never block.
 */

export const JOB_DESCRIPTION_MIN_LENGTH = 120

/**
 * Typical minimum sea service before a member holds these senior ranks (taxonomy keys). Small and
 * conservative on purpose: only ranks where a low figure is clearly a mistake.
 */
export const TYPICAL_MIN_SEA_YEARS: Readonly<Record<string, { years: number; name: string }>> = {
  master: { years: 10, name: 'Master Mariner' },
  chief_engineer: { years: 10, name: 'Chief Engineer' },
  chief_officer: { years: 5, name: 'Chief Officer' },
  second_engineer: { years: 5, name: 'Second Engineer' },
}

export type JobFormValues = {
  title: string
  description: string
  domain: 'sea' | 'shore'
  location: string | null
  regions: readonly string[]
  salaryMin: number | null
  salaryMax: number | null
  experienceMinYears: number | null
  experienceMaxYears: number | null
  joiningFrom: string | null
  acceptedRoleKeys?: readonly string[]
  /** An older job's rank text, used when it has no rank keys. */
  rank?: string | null
}

export type JobFormField =
  | 'title'
  | 'description'
  | 'location'
  | 'regions'
  | 'salaryMax'
  | 'experienceMinYears'
  | 'experienceMaxYears'
  | 'joiningFrom'

export type JobFormIssue = { field: JobFormField; message: string }

export type JobFormValidation = { errors: JobFormIssue[]; warnings: JobFormIssue[] }

export type JobFormRuleOptions = {
  /** Today as YYYY-MM-DD (UTC by default, like the job lifecycle). */
  today?: string
  /** The joining date already saved on the job: an unchanged past date does not block other edits. */
  savedJoiningFrom?: string | null
}

const collapse = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en')
const isWorldwide = (region: string) => locationKind(region) === 'worldwide'

function locationIssues(values: JobFormValues): JobFormIssue[] {
  const location = values.location?.trim() ?? ''
  const kind = locationKind(location)
  const regions = values.regions.map((region) => region.trim()).filter(Boolean)
  const hasWorldwide = regions.some(isWorldwide)
  const specific = regions.filter((region) => !isWorldwide(region))
  const issues: JobFormIssue[] = []

  // "Worldwide" as the location, but the regions name only some parts of the world.
  if (kind === 'worldwide' && specific.length && !hasWorldwide) {
    issues.push({ field: 'location', message: `The location says “${location}” but the sailing regions are only ${specific.join(', ')}. Set the location to the joining port or city, or add Worldwide to the regions.` })
  }
  // A shore job at one office ("Andheri East") cannot cover the whole world.
  if (values.domain === 'shore' && kind === 'place' && hasWorldwide) {
    issues.push({ field: 'regions', message: `A shore job based in ${location} can’t have Worldwide as its region. Remove Worldwide from the regions, or set the location to Remote if the work can be done from anywhere.` })
  }
  if (values.domain === 'shore' && kind === 'onboard') {
    issues.push({ field: 'location', message: 'A shore job can’t be located onboard. Enter the office city, or Remote.' })
  }
  if (values.domain === 'sea' && kind === 'remote') {
    issues.push({ field: 'location', message: 'A sea job can’t be remote. Enter the joining port, Onboard or Worldwide.' })
  }
  return issues
}

/** The typical minimum for the job's ranks, when every accepted rank has one (else no warning). */
function typicalMinimum(values: JobFormValues) {
  const keys = values.acceptedRoleKeys?.length
    ? values.acceptedRoleKeys.filter((key) => !roleByKey(key)?.other)
    : [normaliseLegacyRank(values.rank)].filter((key): key is string => Boolean(key))
  if (!keys.length) return null
  const entries = keys.map((key) => TYPICAL_MIN_SEA_YEARS[key])
  if (entries.some((entry) => !entry)) return null
  return entries.reduce((lowest, entry) => (entry!.years < lowest!.years ? entry : lowest))!
}

export function validateJobForm(values: JobFormValues, options: JobFormRuleOptions = {}): JobFormValidation {
  const errors: JobFormIssue[] = []
  const warnings: JobFormIssue[] = []
  const today = options.today ?? new Date().toISOString().slice(0, 10)

  const description = values.description.trim()
  if (description && values.title.trim() && collapse(description) === collapse(values.title)) {
    errors.push({ field: 'description', message: 'The description repeats the job title. Describe the duties, contract and vessel.' })
  } else if (description.length < JOB_DESCRIPTION_MIN_LENGTH) {
    errors.push({ field: 'description', message: `Describe the role in at least ${JOB_DESCRIPTION_MIN_LENGTH} characters (${description.length} so far).` })
  }

  if (values.salaryMin !== null && values.salaryMax !== null && values.salaryMin > values.salaryMax) {
    errors.push({ field: 'salaryMax', message: 'Maximum salary must be at least the minimum salary.' })
  }
  if (values.experienceMinYears !== null && values.experienceMaxYears !== null && values.experienceMinYears > values.experienceMaxYears) {
    errors.push({ field: 'experienceMaxYears', message: 'Maximum experience must be at least the minimum experience.' })
  }

  const joining = values.joiningFrom?.trim() || null
  if (joining && /^\d{4}-\d{2}-\d{2}$/.test(joining) && joining < today && joining !== options.savedJoiningFrom) {
    errors.push({ field: 'joiningFrom', message: 'The joining date can’t be in the past. Pick today or a later date.' })
  }

  errors.push(...locationIssues(values))

  const typical = typicalMinimum(values)
  if (typical && values.experienceMinYears !== null && values.experienceMinYears < typical.years) {
    warnings.push({ field: 'experienceMinYears', message: `${typical.name} usually needs ${typical.years}+ years of sea service; check the experience years.` })
  }

  return { errors, warnings }
}
