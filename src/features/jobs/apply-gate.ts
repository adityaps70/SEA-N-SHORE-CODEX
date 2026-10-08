import { DEFAULT_MIN_MATCH_TO_APPLY } from '@/features/roles/job-role-input'
import type { JobListing, JobMatchResult, JobProfileGap, JobProfileGapKey } from './types'

/** The in-place profile editor (round 11) that fixes each missing item, opened with /profile?edit=…&job=… */
export const PROFILE_GAP_EDITORS: Record<JobProfileGapKey, string> = {
  rank: 'profile-header',
  target_role: 'profile-header',
  role: 'profile-header',
  sea_time: 'profile-maritime',
  vessel_types: 'profile-maritime',
  certificates: 'credential:new',
}

/** Cards a link may open on My Profile, with the label the discard prompt uses. */
export const PROFILE_EDIT_LINK_CARDS: Record<string, string> = {
  'profile-header': 'Basic information',
  'profile-maritime': 'Maritime Experience',
  'credential:new': 'Add credential',
}

export function profileEditHref(cardId: string, jobId?: string) {
  const params = new URLSearchParams({ edit: cardId })
  if (jobId) params.set('job', jobId)
  return `/profile?${params.toString()}`
}

export type ApplyGateGap = JobProfileGap & { href: string }

export type ApplyGate =
  | { status: 'open' }
  | { status: 'sea_job_profile_type'; message: string; href: string }
  | { status: 'incomplete'; message: string; gaps: ApplyGateGap[] }
  | { status: 'below_minimum'; message: string; minimum: number; score: number; missing: string[] }

export const SEA_JOB_PROFILE_TYPE_MESSAGE = 'This role is for seafarers. Update your profile type if this is wrong.'
export const INCOMPLETE_PROFILE_MESSAGE = 'Complete your profile to apply'

export function belowMinimumMessage(minimum: number, score: number) {
  return `Below this job’s minimum (${minimum}%) · you’re at ${score}%`
}

/**
 * Minimum match to apply (round 12), enforced on the server by applyToJob and shown on the Apply button:
 * - minimum 0, or a shore job with nothing comparable (no score): anyone may apply;
 * - a sea-going job and a profile type other than Seafarer / Student / Cadet: refused;
 * - profile data the job asks for is missing: "Complete your profile to apply" with each item;
 * - score below the job's minimum: refused with the score and what is missing;
 * - otherwise: apply as usual.
 */
export function evaluateApplyGate(job: Pick<JobListing, 'id' | 'minMatchToApply'>, match: JobMatchResult | null): ApplyGate {
  const minimum = job.minMatchToApply ?? DEFAULT_MIN_MATCH_TO_APPLY
  if (minimum <= 0 || !match) return { status: 'open' }
  if (match.seaJobForOtherProfileType) {
    return { status: 'sea_job_profile_type', message: SEA_JOB_PROFILE_TYPE_MESSAGE, href: profileEditHref('profile-header', job.id) }
  }
  if (match.score === null) return { status: 'open' }
  if (match.profileGaps?.length) {
    return {
      status: 'incomplete',
      message: INCOMPLETE_PROFILE_MESSAGE,
      gaps: match.profileGaps.map((gap) => ({ ...gap, href: profileEditHref(PROFILE_GAP_EDITORS[gap.key], job.id) })),
    }
  }
  if (match.score < minimum) {
    return { status: 'below_minimum', message: belowMinimumMessage(minimum, match.score), minimum, score: match.score, missing: match.missingRequirements }
  }
  return { status: 'open' }
}

/** The refusal text the server returns for a gate that is not open. */
export function applyGateError(gate: ApplyGate): string | null {
  switch (gate.status) {
    case 'open':
      return null
    case 'sea_job_profile_type':
      return gate.message
    case 'incomplete':
      return `${gate.message}: ${gate.gaps.map((gap) => gap.label).join(', ')}.`
    case 'below_minimum':
      return gate.missing.length ? `${gate.message}. Missing: ${gate.missing.join(', ')}.` : `${gate.message}.`
  }
}
