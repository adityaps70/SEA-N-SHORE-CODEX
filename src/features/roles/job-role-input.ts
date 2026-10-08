import { acceptedRolesLabel, departmentByKey, jobDepartments, roleByKey, type RoleDomain } from './taxonomy'

export const DEFAULT_MIN_MATCH_TO_APPLY = 70

export type JobRoleFields = {
  departmentKey?: string | null
  acceptedRoleKeys?: readonly string[]
  roleOtherText?: string | null
  minMatchToApply?: number | null
}

export type JobRoleSelection = {
  departmentKey: string | null
  acceptedRoleKeys: string[]
  roleOtherText: string | null
  minMatchToApply: number
  /** The job's sea / shore domain: the department's when one is chosen. */
  domain: RoleDomain
  /** Old text columns kept in step for display, search and alerts: the department and rank labels. */
  departmentLabel: string | null
  rankLabel: string | null
}

export type JobRoleResult = { ok: true; data: JobRoleSelection } | { ok: false; error: string }

/**
 * Checks a job's department, accepted ranks / roles and minimum match against the taxonomy
 * (round 12). New jobs need a department and at least one accepted rank; an older job being edited
 * may still have none and keeps its old text until a department is picked.
 */
export function validateJobRoles(
  fields: JobRoleFields,
  context: { domain: RoleDomain; requireDepartment: boolean },
): JobRoleResult {
  const minMatch = fields.minMatchToApply ?? DEFAULT_MIN_MATCH_TO_APPLY
  if (!Number.isInteger(minMatch) || minMatch < 0 || minMatch > 100) {
    return { ok: false, error: 'Set the minimum match to apply between 0 and 100 (0 turns it off).' }
  }

  const departmentKey = fields.departmentKey?.trim() || null
  const keys = [...new Set((fields.acceptedRoleKeys ?? []).map((key) => key.trim()).filter(Boolean))]

  if (!departmentKey) {
    if (context.requireDepartment) return { ok: false, error: 'Choose the department for this job.' }
    if (keys.length) return { ok: false, error: 'Choose the department for the accepted ranks / roles.' }
    return {
      ok: true,
      data: { departmentKey: null, acceptedRoleKeys: [], roleOtherText: null, minMatchToApply: minMatch, domain: context.domain, departmentLabel: null, rankLabel: null },
    }
  }

  const department = departmentByKey(departmentKey)
  if (!department || !jobDepartments().some((entry) => entry.key === departmentKey)) {
    return { ok: false, error: 'Choose a department from the list.' }
  }
  if (!keys.length) return { ok: false, error: 'Choose at least one accepted rank / role.' }
  if (keys.length > 20) return { ok: false, error: 'Choose no more than 20 accepted ranks / roles.' }
  for (const key of keys) {
    const role = roleByKey(key)
    if (!role || role.department !== departmentKey) {
      return { ok: false, error: 'Choose accepted ranks / roles from the list for this department.' }
    }
  }

  const wantsOther = keys.some((key) => roleByKey(key)?.other)
  const otherText = fields.roleOtherText?.trim().replace(/\s+/g, ' ') || null
  if (wantsOther && (!otherText || otherText.length < 2)) return { ok: false, error: 'Type the rank / role for "Other".' }
  if (otherText && otherText.length > 100) return { ok: false, error: 'Keep the "Other" rank / role to 100 characters or fewer.' }

  const roleOtherText = wantsOther ? otherText : null
  return {
    ok: true,
    data: {
      departmentKey,
      acceptedRoleKeys: keys,
      roleOtherText,
      minMatchToApply: minMatch,
      domain: department.domain,
      departmentLabel: department.label,
      rankLabel: acceptedRolesLabel(keys, roleOtherText)?.slice(0, 120) ?? null,
    },
  }
}
