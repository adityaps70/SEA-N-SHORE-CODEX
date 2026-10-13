import { PERSONA_LABELS } from '@/features/profiles/persona'
import { acceptedRolesLabel, ladderDistance, personaMatchesSeaJobs, personaPicksRole, roleByKey } from '@/features/roles/taxonomy'
import {
  certificateTypeByCode,
  matchCertificateType,
  normaliseTaxonomyText,
  vesselGroupOf,
  vesselTypeByCode,
  vesselTypeCodes,
} from '@/features/taxonomy/maritime-taxonomy'
import { candidatePersona, candidateRoleKeys, isSeaJob, jobAcceptedRoleKeys } from '@/features/jobs/matching'
import type { JobCandidateProfile, JobCredential, JobListing, JobMatchBand, JobMatchResult, JobProfileGap } from '@/features/jobs/types'
import { JOB_WEIGHTS, JOB_WEIGHTS_VERSION, jobFreshness, specificityFactor } from './job-weights'

/**
 * Round G (G3): the jobs match, version 2. One scorer for Jobs for you, job alerts, recruiter Best
 * match and Suggested candidates.
 * - Only criteria the job specifies count: score = points earned / points possible × 100, times a
 *   specificity factor (a job with 0 or 1 criteria can never be Strong). Shown as a band, not a %.
 * - Hard requirements are eligibility, not points: a rank more than one ladder step away (or in
 *   another department), a required COC grade missing or expired, a required visa missing. An
 *   ineligible job keeps its score but sorts below every eligible one, labelled "Not eligible: needs X".
 * - Weights live in job-weights.ts.
 */
const W = JOB_WEIGHTS.criteria

export type JobScoreV2 = JobMatchResult & { version: 2; eligible: boolean; criteria: number; parts: Record<string, number> }

const DAY = 86_400_000

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function bandFor(score: number | null): JobMatchBand | null {
  if (score === null) return null
  if (score >= JOB_WEIGHTS.bands.strong) return 'strong'
  if (score >= JOB_WEIGHTS.bands.good) return 'good'
  if (score >= JOB_WEIGHTS.bands.partial) return 'partial'
  return 'low'
}

const STOP_WORDS = new Set(['and', 'the', 'for', 'with', 'job', 'role', 'jobs', 'roles', 'position', 'opening', 'urgent', 'required', 'wanted', 'hiring', 'senior', 'junior', 'assistant', 'officer', 'manager', 'executive', 'shore', 'based', 'years', 'year', 'experience', 'must', 'have', 'good', 'should', 'will', 'from', 'any', 'all', 'our', 'you', 'your', 'are', 'who', 'able'])

function words(text: string | null | undefined): string[] {
  return (text ?? '').toLocaleLowerCase('en').split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
}

function placeParts(location: string | null | undefined) {
  const parts = (location ?? '').split(',').map((part) => normaliseTaxonomyText(part)).filter(Boolean)
  return { city: parts[0] ?? null, country: parts.length > 1 ? parts[parts.length - 1]! : null }
}

function yearsBetween(from: string | null, to: string | null, today: Date): number {
  const start = parseDate(from)
  if (!start) return 0
  const end = parseDate(to) ?? today
  return Math.max(0, (end.getTime() - start.getTime()) / (365.25 * DAY))
}

/** The certificate type code of a requirement or credential: stored, else matched from the name. */
function certificateCode(item: { name: string; code?: string | null }): string | null {
  return item.code ?? matchCertificateType(item.name)
}

/**
 * Whether a credential satisfies a required certificate. COC grades: a higher grade on the same
 * ladder satisfies a lower one (Master covers Chief Mate); an ungraded COC covers a graded
 * requirement only when the member's own rank is at or above that grade.
 */
function satisfies(credential: JobCredential, requiredName: string, requiredCode: string | null, memberRoleKeys: readonly string[]): boolean {
  const credentialCode = certificateCode(credential)
  if (requiredCode && credentialCode) {
    if (credentialCode === requiredCode) return true
    const required = certificateTypeByCode(requiredCode)
    const held = certificateTypeByCode(credentialCode)
    if (required?.category === 'coc' && held?.category === 'coc') {
      if (!required.cocRankCode) return true
      if (held.cocRankCode) {
        const distance = ladderDistance(held.cocRankCode, required.cocRankCode)
        return distance !== null && distance <= 0
      }
      return memberRoleKeys.some((key) => {
        const distance = ladderDistance(key, required.cocRankCode)
        return distance !== null && distance <= 0
      })
    }
    return false
  }
  return normaliseTaxonomyText(credential.name) === normaliseTaxonomyText(requiredName)
}

function isExpired(credential: JobCredential, today: Date) {
  const expiry = parseDate(credential.expiresAt)
  return Boolean(expiry && expiry.getTime() < today.getTime())
}

export function scoreJobV2(job: JobListing, profile: JobCandidateProfile, today = new Date()): JobScoreV2 {
  const persona = candidatePersona(profile)
  const reasons: string[] = []
  const missingRequirements: string[] = []
  const warnings: string[] = []
  const profileGaps: JobProfileGap[] = []
  const hardFails: string[] = []
  const parts: Record<string, number> = {}
  const seaJob = isSeaJob(job)
  const pushUnique = (target: string[], value: string) => { if (!target.includes(value)) target.push(value) }

  if (seaJob && !personaMatchesSeaJobs(persona)) {
    return {
      version: 2, score: null, band: null, reasons, missingRequirements, warnings, profileGaps, eligible: true, ineligibleReason: null,
      criteria: 0, parts, notice: `Sea-going role. Your profile type is ${PERSONA_LABELS[persona]}.`, seaJobForOtherProfileType: true,
    }
  }

  let earned = 0
  let possible = 0
  let criteria = 0
  const add = (key: string, weight: number, credit: number) => {
    criteria += 1
    possible += weight
    const points = weight * Math.max(0, Math.min(1, credit))
    earned += points
    parts[key] = Math.round(points * 10) / 10
  }

  // Rank: exact (or between two accepted ranks) 25, one ladder step 15, further = not eligible.
  const accepted = jobAcceptedRoleKeys(job)
  const memberKeys = candidateRoleKeys(profile, persona)
  const acceptedLabel = acceptedRolesLabel(accepted) ?? 'the rank this job asks for'
  if (accepted.length) {
    if (!memberKeys.length) {
      add('rank', W.rankExact, 0)
      const otherPicked = Boolean(roleByKey(persona === 'student_cadet' ? profile.targetRoleKey : profile.roleKey)?.other)
      if (!otherPicked && (personaPicksRole(persona) || persona === 'student_cadet')) {
        profileGaps.push(persona === 'student_cadet'
          ? { key: 'target_role', label: 'Your target job role' }
          : persona === 'seafarer' ? { key: 'rank', label: 'Your current or most recent rank' } : { key: 'role', label: 'Your department and role' })
      }
      pushUnique(missingRequirements, acceptedLabel)
    } else {
      const distances = memberKeys.flatMap((key) => accepted.flatMap((target) => {
        const distance = ladderDistance(key, target)
        return distance === null ? [] : [{ key, distance }]
      }))
      const exact = distances.some((entry) => entry.distance === 0)
        || (distances.some((entry) => entry.distance > 0) && distances.some((entry) => entry.distance < 0))
      const nearest = distances.length ? Math.min(...distances.map((entry) => Math.abs(entry.distance))) : null
      const label = roleByKey(memberKeys[0])?.label ?? memberKeys[0]!
      if (exact) {
        add('rank', W.rankExact, 1)
        reasons.push(`Your rank (${label}) is one this job accepts`)
      } else if (nearest === 1) {
        add('rank', W.rankExact, W.rankOneStep / W.rankExact)
        reasons.push(`Your rank (${label}) is one step from what this job asks`)
      } else {
        add('rank', W.rankExact, 0)
        hardFails.push(acceptedLabel)
        pushUnique(missingRequirements, acceptedLabel)
      }
    }
  }

  // Vessel type or group, from the profile's vessel types and its sea-service history.
  if (job.vesselTypes.length || job.vesselTypeCodes?.length) {
    const jobCodes = [...new Set([...(job.vesselTypeCodes ?? []), ...vesselTypeCodes(job.vesselTypes)])]
    const historyCodes = (profile.experiences ?? []).flatMap((experience) => (experience.vesselTypeCode ? [experience.vesselTypeCode] : []))
    const memberCodes = [...new Set([...(profile.vesselTypeCodes ?? []), ...vesselTypeCodes(profile.vesselTypes), ...historyCodes])]
    const exact = jobCodes.find((code) => memberCodes.includes(code))
      ?? job.vesselTypes.find((vessel) => profile.vesselTypes.some((own) => normaliseTaxonomyText(own) === normaliseTaxonomyText(vessel)))
    const jobGroups = new Set(jobCodes.map(vesselGroupOf).filter(Boolean))
    const sameGroup = memberCodes.find((code) => jobGroups.has(vesselGroupOf(code)))
    if (!memberCodes.length && !profile.vesselTypes.length && persona === 'seafarer') profileGaps.push({ key: 'vessel_types', label: 'Vessel types you have sailed on' })
    if (exact) {
      add('vessel', W.vessel, 1)
      reasons.push(`${vesselTypeByCode(exact)?.name ?? exact} experience matches`)
    } else if (sameGroup) {
      add('vessel', W.vessel, JOB_WEIGHTS.credit.vesselSameGroup)
      reasons.push(`${vesselTypeByCode(sameGroup)?.name ?? 'Similar vessel'} experience is close`)
    } else {
      add('vessel', W.vessel, 0)
      for (const vessel of job.vesselTypes) pushUnique(missingRequirements, vessel)
    }
  }

  // Certificates: every listed one (required or preferred); verified counts more than self-reported.
  const certificates = job.certificateList ?? job.certificateRequirements.map((name) => ({ name, code: null, required: true }))
  if (certificates.length) {
    if (!profile.certificates.length) profileGaps.push({ key: 'certificates', label: 'Your certificates' })
    let credit = 0
    for (const requirement of certificates) {
      const code = requirement.code ?? matchCertificateType(requirement.name)
      const matches = profile.certificates.filter((credential) => satisfies(credential, requirement.name, code, memberKeys))
      const valid = matches.filter((credential) => !isExpired(credential, today))
      const best = valid.find((credential) => credential.verified) ?? valid[0]
      if (best) {
        credit += best.verified ? JOB_WEIGHTS.credit.certificateVerified : JOB_WEIGHTS.credit.certificateSelfReported
        if (!best.verified) warnings.push(`${requirement.name} is self-reported and not yet verified.`)
        continue
      }
      pushUnique(missingRequirements, requirement.name)
      const expired = matches.length > 0
      if (expired) warnings.push(`${requirement.name} is expired.`)
      if (requirement.required && code && certificateTypeByCode(code)?.category === 'coc') {
        hardFails.push(expired ? `a valid ${requirement.name}` : requirement.name)
      }
    }
    add('certificates', W.certificates, credit / certificates.length)
    if (credit === certificates.length) reasons.push('Required certificates are valid and verified')
    else if (credit >= certificates.length * JOB_WEIGHTS.credit.certificateSelfReported) reasons.push('You hold the listed certificates')
  }

  // Sea time in an accepted rank (or one step away) or on the job's vessel types; else total years.
  if (job.experienceMinYears !== null && job.experienceMinYears > 0) {
    const jobCodes = new Set([...(job.vesselTypeCodes ?? []), ...vesselTypeCodes(job.vesselTypes)])
    const experiences = profile.experiences ?? []
    const relevant = experiences.filter((experience) => {
      if (seaJob && experience.track !== 'sea_service') return false
      if (!seaJob) return true
      const inRank = experience.rankCode && accepted.some((key) => {
        const distance = ladderDistance(experience.rankCode, key)
        return distance !== null && Math.abs(distance) <= 1
      })
      return Boolean(inRank || (experience.vesselTypeCode && jobCodes.has(experience.vesselTypeCode)) || (!accepted.length && !jobCodes.size))
    })
    const historyYears = relevant.reduce((sum, experience) => sum + yearsBetween(experience.startedOn, experience.endedOn, today), 0)
    const years = experiences.length ? historyYears : profile.sailingExperienceYears
    if (years === null) {
      add('seaTime', W.seaTime, 0)
      if (persona === 'seafarer') profileGaps.push({ key: 'sea_time', label: 'Your sea service (years)' })
      pushUnique(missingRequirements, `${job.experienceMinYears}+ years experience`)
    } else {
      add('seaTime', W.seaTime, years / job.experienceMinYears)
      if (years >= job.experienceMinYears) reasons.push(seaJob ? `Sea time meets the ${job.experienceMinYears}+ years asked` : `Experience meets the ${job.experienceMinYears}+ years asked`)
      else pushUnique(missingRequirements, `${job.experienceMinYears}+ years experience`)
    }
  }

  // Availability: the profile's "available from" against the joining window.
  if (job.joiningFrom || job.joiningUntil) {
    const available = parseDate(profile.availableFrom)
    const until = parseDate(job.joiningUntil) ?? new Date(parseDate(job.joiningFrom)!.getTime() + JOB_WEIGHTS.joiningWindowDays * DAY)
    if (!available) {
      add('availability', W.availability, 0)
      if (persona === 'seafarer') profileGaps.push({ key: 'availability', label: 'When you are available from' })
    } else if (available.getTime() <= until.getTime()) {
      add('availability', W.availability, 1)
      reasons.push('Available in time for joining')
    } else if (available.getTime() <= until.getTime() + JOB_WEIGHTS.availabilityGraceDays * DAY) {
      add('availability', W.availability, JOB_WEIGHTS.credit.availabilityWithinGrace)
    } else {
      add('availability', W.availability, 0)
      warnings.push('You are available after this job’s joining date.')
    }
  }

  // Skills (shore jobs): words of the title and requirements found in skills, experience and headline.
  if (!seaJob) {
    const jobWords = [...new Set([...words(job.title), ...words(job.requirements)])]
    if (jobWords.length) {
      const memberWords = new Set([
        ...profile.skills.flatMap(words),
        ...(profile.experienceTitles ?? []).flatMap(words),
        ...words(profile.headline),
        ...words(profile.occupationText),
        ...words(roleByKey(profile.roleKey)?.label),
      ])
      const matched = jobWords.filter((word) => memberWords.has(word))
      add('skills', W.skills, matched.length / Math.min(jobWords.length, JOB_WEIGHTS.skillsWordsForFull))
      if (matched.length) reasons.push(`Your skills mention ${matched.slice(0, 3).map((word) => `“${word}”`).join(', ')}`)
    }
  }

  // Visas: proportional over every listed visa; a missing required one is not eligible.
  const visas = job.visaList ?? job.visaRequirements.map((name) => ({ name, required: true }))
  if (visas.length) {
    const held = new Set(profile.visas.map(normaliseTaxonomyText))
    const matched = visas.filter((visa) => held.has(normaliseTaxonomyText(visa.name)))
    add('visas', W.visas, matched.length / visas.length)
    for (const visa of visas) {
      if (held.has(normaliseTaxonomyText(visa.name))) continue
      pushUnique(missingRequirements, visa.name)
      if (visa.required) hardFails.push(`${visa.name} visa`)
    }
    if (matched.length === visas.length) reasons.push('Visa requirements match your profile')
  }

  // Trading area ("Worldwide" or blank is not a requirement).
  if (job.regions.length && !job.regions.some((region) => normaliseTaxonomyText(region) === 'worldwide')) {
    const areas = new Set(profile.tradingAreas.map(normaliseTaxonomyText))
    const hit = job.regions.some((region) => areas.has(normaliseTaxonomyText(region)))
    add('tradingArea', W.tradingArea, hit ? 1 : 0)
    if (hit) reasons.push('Trading-area experience matches the sailing region')
  }

  // Location (shore jobs): same city, or same country for partial credit.
  if (!seaJob && job.location && !/remote/i.test(job.location)) {
    const jobPlace = placeParts(job.location)
    const memberPlace = placeParts(profile.location)
    if (memberPlace.city) {
      const credit = jobPlace.city && memberPlace.city === jobPlace.city ? 1
        : jobPlace.country && memberPlace.country === jobPlace.country ? JOB_WEIGHTS.credit.locationSameCountry : 0
      add('location', W.location, credit)
      if (credit === 1) reasons.push(`Based in ${job.location.split(',')[0]!.trim()}`)
    } else {
      add('location', W.location, 0)
    }
  }

  if (job.domain === 'shore' && profile.shoreCareerPreference) reasons.push('Matches your shore-career preference')

  const eligible = hardFails.length === 0
  const ineligibleReason = eligible ? null : `Not eligible: needs ${hardFails.join(', ')}`
  if (possible === 0) {
    return { version: 2, score: null, band: null, reasons, missingRequirements, warnings: [...new Set(warnings)], profileGaps, eligible, ineligibleReason, criteria, parts }
  }
  const score = Math.max(0, Math.min(100, Math.round((earned / possible) * 100 * specificityFactor(criteria))))
  parts.specificity = specificityFactor(criteria)
  return {
    version: 2,
    score,
    band: bandFor(score),
    reasons,
    missingRequirements,
    warnings: [...new Set(warnings)],
    profileGaps,
    eligible,
    ineligibleReason,
    criteria,
    parts,
  }
}

/** A job past its apply-by date: never recommended, alerted or pushed. */
export function isJobClosed(job: Pick<JobListing, 'applyUntil'>, today = new Date()): boolean {
  const until = parseDate(job.applyUntil)
  return Boolean(until && until.getTime() + DAY <= today.getTime())
}

/**
 * Ordering for Jobs for you: eligible before not eligible; then match × freshness (half-life 14
 * days); unscored jobs count as just below Partial; newest first on ties.
 */
export function compareRankedJobs(
  left: { job: Pick<JobListing, 'publishedAt' | 'createdAt' | 'id'>; match: JobMatchResult | null },
  right: { job: Pick<JobListing, 'publishedAt' | 'createdAt' | 'id'>; match: JobMatchResult | null },
  now = new Date(),
): number {
  const eligibleDelta = Number(right.match?.eligible ?? true) - Number(left.match?.eligible ?? true)
  if (eligibleDelta) return eligibleDelta
  const key = (item: typeof left) => (item.match?.score ?? JOB_WEIGHTS.unscoredBaseline) * jobFreshness(item.job.publishedAt ?? item.job.createdAt, now)
  const delta = key(right) - key(left)
  if (Math.abs(delta) > 1e-9) return delta
  const dateDelta = Date.parse(right.job.publishedAt ?? right.job.createdAt) - Date.parse(left.job.publishedAt ?? left.job.createdAt)
  return dateDelta || (left.job.id < right.job.id ? -1 : 1)
}

export { JOB_WEIGHTS_VERSION }
