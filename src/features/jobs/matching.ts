import type { JobCandidateProfile, JobListing, JobMatchResult } from './types'

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

export function scoreJobMatch(job: JobListing, profile: JobCandidateProfile, today = new Date()): JobMatchResult {
  let score = 0
  const reasons: string[] = []
  const missingRequirements: string[] = []
  const warnings: string[] = []

  // Rank / role fit: 20 points.
  if (!job.rank) {
    score += 20
  } else if (profile.rank && normalize(profile.rank) === normalize(job.rank)) {
    score += 20
    reasons.push(`Current rank matches ${job.rank}`)
  } else {
    pushUnique(missingRequirements, job.rank)
  }

  // Vessel background: 15 points, satisfied by any required vessel type.
  if (!job.vesselTypes.length) {
    score += 15
  } else {
    const matchedVessel = job.vesselTypes.find((vessel) => includesCI(profile.vesselTypes, vessel))
    if (matchedVessel) {
      score += 15
      reasons.push(`${matchedVessel} vessel experience matches`)
    } else {
      job.vesselTypes.forEach((vessel) => pushUnique(missingRequirements, vessel))
    }
  }

  // Total maritime experience: 15 points.
  if (job.experienceMinYears === null) {
    score += 15
  } else if ((profile.sailingExperienceYears ?? -1) >= job.experienceMinYears) {
    score += 15
    reasons.push(`Experience meets the ${job.experienceMinYears}+ year requirement`)
  } else {
    pushUnique(missingRequirements, `${job.experienceMinYears}+ years experience`)
  }

  // Credentials: 20 points, apportioned across required certificates.
  if (!job.certificateRequirements.length) {
    score += 20
  } else {
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
    score += 20 * (matchedCertificates / job.certificateRequirements.length)
    if (matchedCertificates === job.certificateRequirements.length) reasons.push('Required certificates are valid')
  }

  // Visa eligibility: 10 points.
  if (!job.visaRequirements.length) {
    score += 10
  } else {
    const matchedVisas = job.visaRequirements.filter((visa) => includesCI(profile.visas, visa))
    score += 10 * (matchedVisas.length / job.visaRequirements.length)
    for (const visa of job.visaRequirements) {
      if (!includesCI(profile.visas, visa)) {
        pushUnique(missingRequirements, visa)
        warnings.push(`${visa} visa requirement is not present on your profile.`)
      }
    }
    if (matchedVisas.length === job.visaRequirements.length) reasons.push('Visa requirements match your profile')
  }

  // Trading / sailing region: 5 points.
  if (!job.regions.length || job.regions.some((region) => normalize(region) === 'worldwide')) {
    score += 5
  } else if (job.regions.some((region) => includesCI(profile.tradingAreas, region))) {
    score += 5
    reasons.push('Trading-area experience matches the sailing region')
  }

  // Joining availability: 10 points.
  const joiningFrom = parseDate(job.joiningFrom)
  const joiningUntil = parseDate(job.joiningUntil)
  const available = parseDate(profile.availability)
  if (!joiningFrom && !joiningUntil) {
    score += 10
  } else if (available && (!joiningUntil || available.getTime() <= joiningUntil.getTime())) {
    score += 10
    reasons.push('Joining availability fits the required window')
  } else {
    warnings.push('Your recorded availability may not fit the required joining window.')
  }

  // Career direction: 5 points.
  if ((job.domain === 'shore' && profile.shoreCareerPreference) || (job.domain === 'sea' && !profile.shoreCareerPreference)) {
    score += 5
    reasons.push(job.domain === 'shore' ? 'Matches your shore-career preference' : 'Matches your current sailing career track')
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons,
    missingRequirements,
    warnings: [...new Set(warnings)],
  }
}
