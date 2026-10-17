import { evaluateApplyGate } from '@/features/jobs/apply-gate'
import { scoreJobMatch } from '@/features/jobs/matching'
import { pushCheck } from '@/features/jobs/match-checks'
import type { JobCandidateProfile, JobListing, JobMatchResult } from '@/features/jobs/types'
import { scoreJobV2 } from './job-scorer'

/**
 * Round G (G3): matching v2 for what the member sees (cards, order, alerts, digest), kept consistent
 * with the employer's minimum match to apply. That gate is still enforced with the round-12 score
 * (applyToJob), so a job the gate refuses is shown as not eligible instead of as a Strong or Good
 * match the member then cannot apply to. The minimum is already shown on the Apply button.
 */
export function scoreJobForMember(job: JobListing, profile: JobCandidateProfile, today = new Date()): { match: JobMatchResult; gateMatch: JobMatchResult } {
  const gateMatch = scoreJobMatch(job, profile, today)
  const match = scoreJobV2(job, profile, today)
  if (match.eligible === false) return { match, gateMatch }
  const gate = evaluateApplyGate(job, gateMatch)
  if (gate.status === 'below_minimum') {
    // What the gate found missing joins the list, so "to check" agrees with the Apply button.
    const missingRequirements = [...new Set([...match.missingRequirements, ...gate.missing])]
    // Round H (H7): and their explained checks, so "Check before applying" lists them too.
    const checks = [...(match.checks ?? [])]
    for (const check of gateMatch.checks ?? []) pushCheck(checks, check)
    return { match: { ...match, eligible: false, ineligibleReason: `Not eligible: below this job’s minimum match (${gate.minimum}%)`, missingRequirements, checks }, gateMatch }
  }
  if (gate.status === 'sea_job_profile_type') {
    return { match: { ...match, eligible: false, ineligibleReason: 'Not eligible: this role is for seafarers' }, gateMatch }
  }
  return { match, gateMatch }
}
