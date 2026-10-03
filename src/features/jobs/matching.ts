import { PERSONA_LABELS, type Persona } from '@/features/profiles/persona'
import {
  acceptedRolesLabel,
  cadetStageRoleKey,
  isSeaDepartment,
  ladderDistance,
  normaliseLegacyRank,
  personaMatchesSeaJobs,
  personaPicksRole,
  rankPersonaFor,
  roleByKey,
} from '@/features/roles/taxonomy'
import type { JobCandidateProfile, JobListing, JobMatchBand, JobMatchResult, JobProfileGap } from './types'

/**
 * Your Maritime Match (round 12).
 * - Only what the job specifies is scored: a blank criterion is left out (no free points), and the
 *   score is points earned / points possible × 100. Nothing comparable → score null.
 * - Weights when specified: rank / role 35, sea experience 15, vessel types 15, certificates 20
 *   (verified 1, self-reported 0.75, expired 0), visas 10, trading region 5.
 * - Rank / role is a gate on taxonomy keys: accepted or one level more senior = full credit; one
 *   level below the most junior accepted rank = half credit and the total capped at 60; anything
 *   else (two or more below, another department, officer vs rating, "Other", no rank) = no credit
 *   and the total capped at 20. Cadets compare with their target role.
 * - Sea-going jobs are matched only for Seafarer and Student / Cadet profiles.
 */
export const MATCH_WEIGHTS = {
  rank: 35,
  experience: 15,
  vessel: 15,
  certificates: 20,
  visas: 10,
  region: 5,
} as const

export const RANK_HALF_CAP = 60
export const RANK_NONE_CAP = 20

const normalize = (value: string) => value.trim().toLowerCase()
const includesCI = (values: readonly string[], expected: string) => values.some((value) => normalize(value) === normalize(expected))

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function pushUnique(target: string[], value: string) {
  if (!target.includes(value)) target.push(value)
}

export function matchBand(score: number | null): JobMatchBand | null {
  if (score === null) return null
  if (score >= 80) return 'strong'
  if (score >= 60) return 'good'
  if (score >= 40) return 'partial'
  return 'low'
}

/** The profile type matching treats the member as (older profiles map from their profile type). */
export function candidatePersona(profile: Pick<JobCandidateProfile, 'persona' | 'profileType'>): Persona {
  if (profile.persona) return profile.persona
  return profile.profileType ? rankPersonaFor(null, profile.profileType) : 'seafarer'
}

/** A job is sea-going when its department is, or (older jobs without a department) its domain is 'sea'. */
export function isSeaJob(job: Pick<JobListing, 'departmentKey' | 'domain'>): boolean {
  return job.departmentKey ? isSeaDepartment(job.departmentKey) : job.domain === 'sea'
}

/** The accepted rank keys a job compares against: its keys, else its old rank text when recognised. */
export function jobAcceptedRoleKeys(job: Pick<JobListing, 'acceptedRoleKeys' | 'rank'>): string[] {
  if (job.acceptedRoleKeys?.length) return [...job.acceptedRoleKeys]
  const recognised = normaliseLegacyRank(job.rank)
  return recognised ? [recognised] : []
}

/**
 * The rank keys a member is compared with: their rank (or, before they pick one, their old rank text
 * when recognised); for a cadet, their target role and the cadet rank they already hold.
 * "Other" never compares.
 */
export function candidateRoleKeys(profile: JobCandidateProfile, persona: Persona): string[] {
  const usable = (key: string | null | undefined) => {
    const role = roleByKey(key)
    return role && !role.other ? [role.key] : []
  }
  if (persona === 'student_cadet') {
    return [...new Set([...usable(profile.targetRoleKey), ...usable(cadetStageRoleKey(profile.cadetStageKey))])]
  }
  if (!personaPicksRole(persona)) return []
  if (profile.roleKey) return usable(profile.roleKey)
  return usable(normaliseLegacyRank(profile.rank))
}

type RankGate = { credit: 1 | 0.5 | 0; cap: number | null; missing: string | null; reason: string | null; warning: string | null }

function gateFor(candidateKey: string, accepted: readonly string[]): RankGate {
  const distances = accepted.flatMap((key) => {
    const distance = ladderDistance(candidateKey, key)
    return distance === null ? [] : [{ key, distance }]
  })
  const acceptedLabel = acceptedRolesLabel(accepted)
  const none: RankGate = { credit: 0, cap: RANK_NONE_CAP, missing: acceptedLabel, reason: null, warning: null }
  if (!distances.length) return none

  const label = roleByKey(candidateKey)?.label ?? candidateKey
  if (distances.some((entry) => entry.distance === 0)) {
    return { credit: 1, cap: null, missing: null, reason: `Your rank (${label}) is one this job accepts`, warning: null }
  }
  const below = distances.filter((entry) => entry.distance > 0)
  const above = distances.filter((entry) => entry.distance < 0)
  // Between two accepted ranks, or one level more senior than an accepted one: full credit.
  if (below.length && above.length) return { credit: 1, cap: null, missing: null, reason: `Your rank (${label}) fits the ranks this job accepts`, warning: null }
  if (above.length && Math.max(...above.map((entry) => entry.distance)) === -1) {
    return { credit: 1, cap: null, missing: null, reason: `Your rank (${label}) is one level more senior than this job asks`, warning: null }
  }
  if (above.length) {
    return { credit: 0.5, cap: RANK_HALF_CAP, missing: null, reason: null, warning: `You are more senior than the ranks this job asks for (${acceptedLabel}).` }
  }
  const closest = below.reduce((best, entry) => (entry.distance < best.distance ? entry : best))
  if (closest.distance === 1) {
    return { credit: 0.5, cap: RANK_HALF_CAP, missing: roleByKey(closest.key)?.label ?? closest.key, reason: null, warning: null }
  }
  return none
}

function bestGate(candidateKeys: readonly string[], accepted: readonly string[]): RankGate {
  if (!candidateKeys.length) {
    return { credit: 0, cap: RANK_NONE_CAP, missing: acceptedRolesLabel(accepted), reason: null, warning: null }
  }
  const gates = candidateKeys.map((key) => gateFor(key, accepted))
  return gates.reduce((best, gate) => (gate.credit > best.credit ? gate : best))
}

const STOP_WORDS = new Set(['and', 'the', 'for', 'with', 'job', 'role', 'jobs', 'roles', 'position', 'opening', 'urgent', 'required', 'wanted', 'hiring', 'senior', 'junior', 'assistant', 'officer', 'manager', 'executive', 'shore', 'based'])

function words(text: string | null | undefined): string[] {
  return (text ?? '').toLocaleLowerCase('en').split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
}

function rankGapLabel(persona: Persona) {
  if (persona === 'student_cadet') return { key: 'target_role' as const, label: 'Your target job role' }
  if (persona === 'seafarer') return { key: 'rank' as const, label: 'Your current or most recent rank' }
  return { key: 'role' as const, label: 'Your department and role' }
}

export function scoreJobMatch(job: JobListing, profile: JobCandidateProfile, today = new Date()): JobMatchResult {
  const persona = candidatePersona(profile)
  const reasons: string[] = []
  const missingRequirements: string[] = []
  const warnings: string[] = []
  const profileGaps: JobProfileGap[] = []
  const seaJob = isSeaJob(job)

  if (seaJob && !personaMatchesSeaJobs(persona)) {
    return {
      score: null,
      band: null,
      reasons,
      missingRequirements,
      warnings,
      notice: `Sea-going role. Your profile type is ${PERSONA_LABELS[persona]}.`,
      seaJobForOtherProfileType: true,
      profileGaps,
    }
  }

  let earned = 0
  let possible = 0
  let cap: number | null = null

  // Rank / role: a gate on taxonomy keys.
  const accepted = jobAcceptedRoleKeys(job)
  if (accepted.length) {
    possible += MATCH_WEIGHTS.rank
    const candidateKeys = candidateRoleKeys(profile, persona)
    if (!candidateKeys.length && (personaPicksRole(persona) || persona === 'student_cadet')) {
      const otherPicked = Boolean(roleByKey(persona === 'student_cadet' ? profile.targetRoleKey : profile.roleKey)?.other)
      if (!otherPicked) profileGaps.push(rankGapLabel(persona))
    }
    const gate = bestGate(candidateKeys, accepted)
    earned += MATCH_WEIGHTS.rank * gate.credit
    cap = gate.cap
    if (gate.reason) reasons.push(gate.reason)
    if (gate.warning) warnings.push(gate.warning)
    if (gate.missing) pushUnique(missingRequirements, gate.missing)
  } else if (!seaJob) {
    // A shore job without accepted roles: its title against the member's shore / other experience,
    // skills and headline.
    const jobWords = [...new Set(words(job.title))]
    if (jobWords.length) {
      possible += MATCH_WEIGHTS.rank
      const memberWords = new Set([
        ...(profile.experienceTitles ?? []).flatMap(words),
        ...profile.skills.flatMap(words),
        ...words(profile.headline),
        ...words(profile.occupationText),
        ...words(roleByKey(profile.roleKey)?.label),
      ])
      const matched = jobWords.filter((word) => memberWords.has(word))
      const share = matched.length / jobWords.length
      earned += MATCH_WEIGHTS.rank * (share >= 0.5 ? 1 : share > 0 ? 0.5 : 0)
      if (matched.length) reasons.push(`Your experience mentions ${matched.map((word) => `“${word}”`).join(', ')}`)
      else pushUnique(missingRequirements, `Experience as ${job.title}`)
    }
  }

  // Sea experience.
  if (job.experienceMinYears !== null) {
    possible += MATCH_WEIGHTS.experience
    if (profile.sailingExperienceYears === null) {
      // Seafarers record sea time on their profile; a cadet without it simply does not meet the minimum.
      if (persona === 'seafarer') profileGaps.push({ key: 'sea_time', label: 'Your sea service (years)' })
      pushUnique(missingRequirements, `${job.experienceMinYears}+ years experience`)
    } else if (profile.sailingExperienceYears >= job.experienceMinYears) {
      earned += MATCH_WEIGHTS.experience
      reasons.push(`Experience meets the ${job.experienceMinYears}+ year requirement`)
    } else {
      pushUnique(missingRequirements, `${job.experienceMinYears}+ years experience`)
    }
  }

  // Vessel background: satisfied by any required vessel type.
  if (job.vesselTypes.length) {
    possible += MATCH_WEIGHTS.vessel
    if (!profile.vesselTypes.length && persona === 'seafarer') profileGaps.push({ key: 'vessel_types', label: 'Vessel types you have sailed on' })
    const matchedVessel = job.vesselTypes.find((vessel) => includesCI(profile.vesselTypes, vessel))
    if (matchedVessel) {
      earned += MATCH_WEIGHTS.vessel
      reasons.push(`${matchedVessel} vessel experience matches`)
    } else {
      job.vesselTypes.forEach((vessel) => pushUnique(missingRequirements, vessel))
    }
  }

  // Credentials, apportioned across the required certificates.
  if (job.certificateRequirements.length) {
    possible += MATCH_WEIGHTS.certificates
    if (!profile.certificates.length) profileGaps.push({ key: 'certificates', label: 'Your certificates' })
    let matchedCertificates = 0
    for (const required of job.certificateRequirements) {
      const credential = profile.certificates.find((item) => normalize(item.name) === normalize(required))
      const expiry = parseDate(credential?.expiresAt)
      const expired = Boolean(expiry && expiry.getTime() < today.getTime())
      if (credential && !expired) {
        matchedCertificates += credential.verified ? 1 : 0.75
        if (!credential.verified) warnings.push(`${required} is self-reported and not yet verified.`)
      } else {
        pushUnique(missingRequirements, required)
        if (credential && expired) warnings.push(`${required} is expired.`)
      }
    }
    earned += MATCH_WEIGHTS.certificates * (matchedCertificates / job.certificateRequirements.length)
    if (matchedCertificates === job.certificateRequirements.length) reasons.push('Required certificates are valid')
  }

  // Visa eligibility.
  if (job.visaRequirements.length) {
    possible += MATCH_WEIGHTS.visas
    const matchedVisas = job.visaRequirements.filter((visa) => includesCI(profile.visas, visa))
    earned += MATCH_WEIGHTS.visas * (matchedVisas.length / job.visaRequirements.length)
    for (const visa of job.visaRequirements) {
      if (!includesCI(profile.visas, visa)) {
        pushUnique(missingRequirements, visa)
        warnings.push(`${visa} visa requirement is not present on your profile.`)
      }
    }
    if (matchedVisas.length === job.visaRequirements.length) reasons.push('Visa requirements match your profile')
  }

  // Trading / sailing region: "Worldwide" or blank is not a requirement.
  if (job.regions.length && !job.regions.some((region) => normalize(region) === 'worldwide')) {
    possible += MATCH_WEIGHTS.region
    if (job.regions.some((region) => includesCI(profile.tradingAreas, region))) {
      earned += MATCH_WEIGHTS.region
      reasons.push('Trading-area experience matches the sailing region')
    }
  }

  // Career direction is a reason, never points.
  if (job.domain === 'shore' && profile.shoreCareerPreference) reasons.push('Matches your shore-career preference')

  if (possible === 0) {
    return { score: null, band: null, reasons, missingRequirements, warnings: [...new Set(warnings)], profileGaps }
  }

  let score = Math.round((earned / possible) * 100)
  if (cap !== null) score = Math.min(score, cap)
  score = Math.max(0, Math.min(100, score))
  return {
    score,
    band: matchBand(score),
    reasons,
    missingRequirements,
    warnings: [...new Set(warnings)],
    profileGaps,
  }
}
