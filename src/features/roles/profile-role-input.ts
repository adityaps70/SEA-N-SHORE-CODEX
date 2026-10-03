import type { Persona } from '@/features/profiles/persona'
import {
  CADET_COURSE_KEYS,
  CADET_STAGE_KEYS,
  departmentsFor,
  personaPicksRole,
  roleByKey,
  roleDisplayLabel,
} from './taxonomy'

/**
 * The structured role fields every profile editor submits (round 12): Department → Rank / Role,
 * the "Other" text, a cadet's stage, course and target job role, and an occupation for people
 * without a maritime rank. Keys are checked against the taxonomy here, not in the database.
 */
export const ROLE_FIELDS_MARKER = 'roleFields'

export const PROFILE_ROLE_FIELD_NAMES = [
  'roleDepartmentKey',
  'roleKey',
  'roleOtherText',
  'cadetStageKey',
  'cadetCourseKey',
  'targetDepartmentKey',
  'targetRoleKey',
  'occupationText',
] as const

export type ProfileRoleSelection = {
  roleDepartmentKey: string | null
  roleKey: string | null
  roleOtherText: string | null
  cadetStageKey: string | null
  cadetCourseKey: string | null
  targetDepartmentKey: string | null
  targetRoleKey: string | null
  occupationText: string | null
}

export type ProfileRoleParseResult =
  | {
      ok: true
      data: ProfileRoleSelection
      /**
       * What maritime_profiles.rank (the text shown next to the name on posts) becomes: the rank
       * label or the typed "Other" text. null leaves the saved rank text as it is.
       */
      rankText: string | null
    }
  | { ok: false; fieldErrors: Record<string, string[]> }

export const EMPTY_PROFILE_ROLE: ProfileRoleSelection = {
  roleDepartmentKey: null,
  roleKey: null,
  roleOtherText: null,
  cadetStageKey: null,
  cadetCourseKey: null,
  targetDepartmentKey: null,
  targetRoleKey: null,
  occupationText: null,
}

/** True when the form carried the structured role fields (older forms and callers leave them alone). */
export function profileRoleFieldsSubmitted(raw: Record<string, unknown> | FormData): boolean {
  const value = raw instanceof FormData ? raw.get(ROLE_FIELDS_MARKER) : raw[ROLE_FIELDS_MARKER]
  return value === '1'
}

function text(raw: Record<string, unknown>, name: string): string | null {
  const value = raw[name]
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/\s+/g, ' ')
  return trimmed || null
}

function rankWord(persona: Persona) {
  return persona === 'seafarer' || persona === 'student_cadet' ? 'rank' : 'role'
}

type Pick = { department: string | null; role: string | null; other: string | null }

function checkPick(
  pick: Pick,
  persona: Persona,
  names: { department: string; role: string },
  required: boolean,
  requiredMessage: string,
): { ok: true; pick: Pick } | { ok: false; fieldErrors: Record<string, string[]> } {
  if (!pick.department && !pick.role) {
    return required ? { ok: false, fieldErrors: { [names.role]: [requiredMessage] } } : { ok: true, pick: { department: null, role: null, other: null } }
  }
  const allowed = departmentsFor(persona)
  if (!pick.department || !allowed.some((department) => department.key === pick.department)) {
    return { ok: false, fieldErrors: { [names.department]: ['Choose a department from the list.'] } }
  }
  const role = roleByKey(pick.role)
  if (!pick.role) {
    return { ok: false, fieldErrors: { [names.role]: [requiredMessage] } }
  }
  if (!role || role.department !== pick.department) {
    return { ok: false, fieldErrors: { [names.role]: [`Choose a ${rankWord(persona)} from the list.`] } }
  }
  if (role.other) {
    if (!pick.other || pick.other.length < 2) {
      return { ok: false, fieldErrors: { roleOtherText: [`Type your ${rankWord(persona)}.`] } }
    }
    if (pick.other.length > 100) {
      return { ok: false, fieldErrors: { roleOtherText: ['Keep this to 100 characters or fewer.'] } }
    }
    return { ok: true, pick }
  }
  return { ok: true, pick: { ...pick, other: null } }
}

/**
 * Validates the structured role fields for a persona.
 * - Seafarer: Department → Rank, required. Shore Professional, Recruiter / HR and Trainer: Department → Role, optional.
 * - Student / Cadet: current stage (required), course (pre-sea only) and target job role (required).
 * - Seafarer Family, Maritime Enthusiast and Other: an optional occupation text, nothing else.
 */
export function parseProfileRoleFields(raw: Record<string, unknown>, persona: Persona): ProfileRoleParseResult {
  if (persona === 'student_cadet') {
    const stage = text(raw, 'cadetStageKey')
    if (!stage || !(CADET_STAGE_KEYS as string[]).includes(stage)) {
      return { ok: false, fieldErrors: { cadetStageKey: ['Choose your current stage.'] } }
    }
    const course = stage === 'pre_sea' ? text(raw, 'cadetCourseKey') : null
    if (course && !(CADET_COURSE_KEYS as string[]).includes(course)) {
      return { ok: false, fieldErrors: { cadetCourseKey: ['Choose a course from the list.'] } }
    }
    const target = checkPick(
      { department: text(raw, 'targetDepartmentKey'), role: text(raw, 'targetRoleKey'), other: text(raw, 'roleOtherText') },
      persona,
      { department: 'targetDepartmentKey', role: 'targetRoleKey' },
      true,
      'Choose the job role you are working towards.',
    )
    if (!target.ok) return target
    return {
      ok: true,
      data: {
        ...EMPTY_PROFILE_ROLE,
        cadetStageKey: stage,
        cadetCourseKey: course,
        targetDepartmentKey: target.pick.department,
        targetRoleKey: target.pick.role,
        roleOtherText: target.pick.other,
      },
      rankText: null,
    }
  }

  if (personaPicksRole(persona)) {
    const checked = checkPick(
      { department: text(raw, 'roleDepartmentKey'), role: text(raw, 'roleKey'), other: text(raw, 'roleOtherText') },
      persona,
      { department: 'roleDepartmentKey', role: 'roleKey' },
      persona === 'seafarer',
      persona === 'seafarer' ? 'Choose your current or most recent rank.' : 'Choose your role.',
    )
    if (!checked.ok) return checked
    const data: ProfileRoleSelection = {
      ...EMPTY_PROFILE_ROLE,
      roleDepartmentKey: checked.pick.department,
      roleKey: checked.pick.role,
      roleOtherText: checked.pick.other,
    }
    return { ok: true, data, rankText: roleDisplayLabel({ roleKey: data.roleKey, otherText: data.roleOtherText }) }
  }

  const occupation = text(raw, 'occupationText')
  if (occupation && occupation.length > 120) {
    return { ok: false, fieldErrors: { occupationText: ['Keep your occupation to 120 characters or fewer.'] } }
  }
  return { ok: true, data: { ...EMPTY_PROFILE_ROLE, occupationText: occupation }, rankText: null }
}

/** Sets the structured role columns on public.profiles. */
export const UPDATE_PROFILE_ROLE_SQL = `update public.profiles
   set role_department_key = $2,
       role_key = $3,
       role_other_text = $4,
       cadet_stage_key = $5,
       cadet_course_key = $6,
       target_department_key = $7,
       target_role_key = $8,
       occupation_text = $9,
       updated_at = now()
   where id = $1`

export function profileRoleValues(profileId: string, role: ProfileRoleSelection): unknown[] {
  return [
    profileId,
    role.roleDepartmentKey,
    role.roleKey,
    role.roleOtherText,
    role.cadetStageKey,
    role.cadetCourseKey,
    role.targetDepartmentKey,
    role.targetRoleKey,
    role.occupationText,
  ]
}

/** The rank text shown on posts follows the picked rank; the legacy text stays when nothing was picked. */
export const UPDATE_PROFILE_RANK_TEXT_SQL = `update public.maritime_profiles set rank = $2, updated_at = now() where user_id = $1`

export type AppliedProfileRole =
  | { ok: true; formData: FormData; role: ProfileRoleSelection | null }
  | { ok: false; fieldErrors: Record<string, string[]> }

/**
 * Reads the structured role fields from a submitted profile form for the persona being saved.
 * The returned copy of the form carries the matching "rank" text, so the existing save paths keep
 * the text shown next to the name on posts in step: the rank label (or typed "Other" text) when one
 * was picked, removed (left as saved) when none was, and cleared when a member without a rank list
 * ticks "Remove … from next to my name". Forms without the fields come back unchanged (role null).
 */
export function applyProfileRoleFields(formData: FormData, persona: Persona): AppliedProfileRole {
  if (!profileRoleFieldsSubmitted(formData)) return { ok: true, formData, role: null }
  const parsed = parseProfileRoleFields(Object.fromEntries(formData), persona)
  if (!parsed.ok) return parsed
  const copy = new FormData()
  for (const [key, value] of formData.entries()) copy.append(key, value)
  if (parsed.rankText) copy.set('rank', parsed.rankText)
  else if (!personaPicksRole(persona) && formData.get('clearRank') === 'on') copy.set('rank', '')
  else copy.delete('rank')
  return { ok: true, formData: copy, role: parsed.data }
}
