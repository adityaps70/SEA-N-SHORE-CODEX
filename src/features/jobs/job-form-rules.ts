import { acceptedRolesLabel, normaliseLegacyRank, roleByKey } from '@/features/roles/taxonomy'
import { pluralize } from '@/lib/format'
import { locationKind } from './job-location'

/**
 * Round H (H7): the job form's checks, shared by the form (as you type and before saving) and the
 * server actions. Errors block saving; warnings are shown but never block.
 *
 * Hotfix P2: a draft saves with only a title (or a picked rank); validateJobDraft holds that. The
 * full checks (validateJobPublish: required fields plus validateJobForm) run on Publish, and the form
 * shows them on a draft as the "Before you publish" checklist.
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
  /** Checked by validateJobPublish only. */
  summary?: string
  departmentKey?: string | null
  roleOtherText?: string | null
  applyUntil?: string | null
}

export type JobFormField =
  | 'title'
  | 'departmentKey'
  | 'acceptedRoleKeys'
  | 'roleOtherText'
  | 'summary'
  | 'description'
  | 'location'
  | 'regions'
  | 'salaryMax'
  | 'experienceMinYears'
  | 'experienceMaxYears'
  | 'joiningFrom'
  | 'applyUntil'

/** The order fields appear in on the form, so the summary and the first focused error follow the page. */
export const JOB_FORM_FIELD_ORDER: readonly JobFormField[] = [
  'title', 'departmentKey', 'acceptedRoleKeys', 'roleOtherText', 'location', 'summary', 'description',
  'experienceMinYears', 'experienceMaxYears', 'regions', 'joiningFrom', 'applyUntil', 'salaryMax',
]

export const JOB_TITLE_MAX_LENGTH = 160

export type JobFormIssue = { field: JobFormField; message: string }

export type JobFormValidation = { errors: JobFormIssue[]; warnings: JobFormIssue[] }

export type JobFormRuleOptions = {
  /** Today as YYYY-MM-DD (UTC by default, like the job lifecycle). */
  today?: string
  /** The joining date already saved on the job: an unchanged past date does not block other edits. */
  savedJoiningFrom?: string | null
}

export type JobPublishRuleOptions = JobFormRuleOptions & {
  /** New jobs and drafts need a department; an older live job may keep only its rank text. Default true. */
  requireDepartment?: boolean
  /** Check the last date to apply here (the form); the server leaves it to job-lifecycle.ts. Default true. */
  checkApplyUntil?: boolean
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

/** The title a draft is saved under: the typed title, or the picked ranks when the title is empty. */
export function jobDraftTitle(values: Pick<JobFormValues, 'title' | 'acceptedRoleKeys' | 'roleOtherText' | 'rank'>) {
  const typed = values.title.trim()
  if (typed) return typed
  const rank = acceptedRolesLabel(values.acceptedRoleKeys ?? [], values.roleOtherText) ?? values.rank?.trim() ?? ''
  return rank.slice(0, JOB_TITLE_MAX_LENGTH).trim()
}

/** What "Save draft" needs: a title of at least 2 characters, or a rank to name the draft after. */
export function validateJobDraft(values: Pick<JobFormValues, 'title' | 'acceptedRoleKeys' | 'roleOtherText' | 'rank'>): JobFormIssue[] {
  return jobDraftTitle(values).length >= 2
    ? []
    : [{ field: 'title', message: 'Add a job title (or pick a rank) to save a draft.' }]
}

function sortIssues(issues: JobFormIssue[]) {
  return [...issues].sort((a, b) => JOB_FORM_FIELD_ORDER.indexOf(a.field) - JOB_FORM_FIELD_ORDER.indexOf(b.field))
}

/**
 * Everything Publish (and Save and publish / republish) needs: the required fields, then the H7 rules.
 * A job without a department may publish only when it is an older job that keeps its rank text.
 */
export function validateJobPublish(values: JobFormValues, options: JobPublishRuleOptions = {}): JobFormValidation {
  const errors: JobFormIssue[] = []
  const today = options.today ?? new Date().toISOString().slice(0, 10)

  if (values.title.trim().length < 2) errors.push({ field: 'title', message: 'Add a job title of at least 2 characters.' })

  const keys = values.acceptedRoleKeys ?? []
  const departmentKey = values.departmentKey?.trim() || null
  if (!departmentKey && (options.requireDepartment ?? true) && !(values.rank?.trim())) {
    errors.push({ field: 'departmentKey', message: 'Choose the department for this job.' })
  } else if (departmentKey && !keys.length) {
    errors.push({ field: 'acceptedRoleKeys', message: 'Choose at least one accepted rank / role.' })
  }
  const wantsOther = keys.some((key) => roleByKey(key)?.other)
  if (wantsOther && (values.roleOtherText?.trim().length ?? 0) < 2) {
    errors.push({ field: 'roleOtherText', message: 'Type the rank / role for “Other”.' })
  }

  if (!values.summary?.trim()) errors.push({ field: 'summary', message: 'Add a short summary candidates will see first.' })

  const applyUntil = values.applyUntil?.trim() || null
  if ((options.checkApplyUntil ?? true) && applyUntil && /^\d{4}-\d{2}-\d{2}$/.test(applyUntil) && applyUntil < today) {
    errors.push({ field: 'applyUntil', message: 'The last date to apply can’t be in the past. Pick today or a later date, or leave it empty.' })
  }

  const rules = validateJobForm(values, options)
  return { errors: sortIssues([...errors, ...rules.errors]), warnings: rules.warnings }
}

/** "1 thing to fix" / "2 things to fix". */
export function thingsToFix(count: number) {
  return `${pluralize(count, 'thing')} to fix`
}
