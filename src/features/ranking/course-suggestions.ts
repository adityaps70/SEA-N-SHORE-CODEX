import { jobsRepository } from '@/features/jobs/repository'
import { candidatePersona, candidateRoleKeys } from '@/features/jobs/matching'
import type { JobCandidateProfile } from '@/features/jobs/types'
import { marketplaceRepository, type MarketplaceCourse } from '@/features/learning/marketplace-repository'
import { ROLES, ladderDistance, roleByKey } from '@/features/roles/taxonomy'
import { CERTIFICATE_TYPE_SEEDS, matchCertificateType, normaliseTaxonomyText, rankDepartmentGroup } from '@/features/taxonomy/maritime-taxonomy'
import { jobPoolOptions } from './job-pool'
import { COURSE_CATEGORY_DEPARTMENTS, SUGGESTION_WEIGHTS } from './suggestion-weights'
import { isRankingEnabled } from './switches'

/**
 * Round G (G5): "Recommended for you" on Learn. Refresher courses for the member's own
 * certificates that expire within 6 months ("Your AFF expires on 12 Mar 2027": the viewer's own
 * data, shown only to them), courses for their department, rank band or next rank (career step),
 * and courses popular with their rank band in the last 90 days. Free courses get no boost.
 */
const W = SUGGESTION_WEIGHTS.courses

export type CourseCandidate = { course: MarketplaceCourse; targetAudience: string[]; bandEnrollments: number }
export type ExpiringCertificate = { code: string; name: string; expiresOn: string }
export type CourseRecommendation = { course: MarketplaceCourse; score: number; reason: string | null }

function phrases(values: readonly string[]) {
  return values.map(normaliseTaxonomyText).filter((value) => value.length >= 2)
}

function mentions(text: string, candidates: readonly string[]) {
  const haystack = ` ${normaliseTaxonomyText(text)} `
  return candidates.some((phrase) => haystack.includes(` ${phrase} `))
}

function rolePhrases(key: string) {
  const role = roleByKey(key)
  return role ? phrases([role.label, ...role.synonyms]) : []
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`))
}

/** Certificates of this member that expire within the refresher window (their own data only). */
export function expiringCertificates(profile: Pick<JobCandidateProfile, 'certificates'>, today = new Date()): ExpiringCertificate[] {
  const horizon = new Date(today)
  horizon.setUTCMonth(horizon.getUTCMonth() + W.refresherMonths)
  return profile.certificates.flatMap((credential) => {
    const code = credential.code ?? matchCertificateType(credential.name)
    if (!code || !credential.expiresAt) return []
    const expiry = new Date(`${credential.expiresAt.slice(0, 10)}T00:00:00Z`)
    if (Number.isNaN(expiry.getTime()) || expiry.getTime() < today.getTime() - 30 * 86_400_000 || expiry > horizon) return []
    return [{ code, name: credential.name, expiresOn: credential.expiresAt.slice(0, 10) }]
  })
}

export function scoreCourses(candidates: readonly CourseCandidate[], profile: JobCandidateProfile | null, today = new Date()): CourseRecommendation[] {
  const persona = profile ? candidatePersona(profile) : null
  const memberKeys = profile && persona ? candidateRoleKeys(profile, persona) : []
  const department = rankDepartmentGroup(memberKeys[0] ?? null)
  const bandKeys = ROLES.filter((role) => !role.other && memberKeys.some((key) => {
    const distance = ladderDistance(key, role.key)
    return distance !== null && Math.abs(distance) <= 1
  })).map((role) => role.key)
  const nextKeys = ROLES.filter((role) => !role.other && memberKeys.some((key) => ladderDistance(key, role.key) === -1)).map((role) => role.key)
  // ladderDistance(member, target) is negative when the target is more senior.
  const bandPhrases = bandKeys.flatMap(rolePhrases)
  const expiring = profile ? expiringCertificates(profile, today) : []
  const certificatePhrases = new Map(expiring.map((certificate) => {
    const seed = CERTIFICATE_TYPE_SEEDS.find((entry) => entry.code === certificate.code)
    return [certificate.code, phrases(seed ? [seed.name, seed.name.replace(/\s*\([^)]*\)\s*/g, ' '), ...seed.synonyms] : [certificate.name])] as const
  }))

  return candidates.map(({ course, targetAudience, bandEnrollments }) => {
    const text = [course.title, course.subtitle ?? '', ...targetAudience].join(' ')
    let score = 0
    const reasons: Array<{ weight: number; text: string }> = []
    for (const certificate of expiring) {
      if (mentions(text, certificatePhrases.get(certificate.code) ?? [])) {
        score += W.refresher
        reasons.push({ weight: W.refresher, text: `Your ${certificate.name} expires on ${formatDate(certificate.expiresOn)}` })
        break
      }
    }
    const nextRole = nextKeys.find((key) => mentions(text, rolePhrases(key)))
    if (nextRole) {
      score += W.careerStep
      reasons.push({ weight: W.careerStep, text: `Your next step: ${roleByKey(nextRole)?.label ?? 'the next rank'}` })
    } else if (bandPhrases.length && mentions(text, bandPhrases)) {
      score += W.rankBand
      reasons.push({ weight: W.rankBand, text: `For ${roleByKey(memberKeys[0])?.label ?? 'your rank'}s` })
    } else if (department && (COURSE_CATEGORY_DEPARTMENTS[normaliseTaxonomyText(course.category)] ?? []).includes(department)) {
      score += W.rankBand / 2
      reasons.push({ weight: W.rankBand / 2, text: 'For your department' })
    }
    if (bandEnrollments > 0) {
      const popularity = Math.min(bandEnrollments * W.popularInRankBand, W.popularInRankBandCap)
      score += popularity
      reasons.push({ weight: popularity, text: 'Popular with members in your rank' })
    }
    reasons.sort((left, right) => right.weight - left.weight)
    return { course, score, reason: reasons[0]?.text ?? null }
  })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || Date.parse(right.course.publishedAt ?? '') - Date.parse(left.course.publishedAt ?? '') || left.course.id.localeCompare(right.course.id))
}

/** The Learn row (null when signed out or the suggestions switch is off for this member). */
export async function getRecommendedCourses(viewerId: string | null, limit = 6): Promise<CourseRecommendation[] | null> {
  if (!viewerId || !await isRankingEnabled('suggestions', viewerId)) return null
  const profile = await jobsRepository.getCandidateProfile(viewerId).catch(() => null)
  const candidates = await marketplaceRepository.listCourseCandidates(viewerId, {
    rankBandKeys: jobPoolOptions(viewerId, profile).rankBandKeys,
    popularityDays: W.popularityDays,
  })
  return scoreCourses(candidates, profile).slice(0, limit)
}

/** "Learners also took" on a course page (null when the switch is off for this viewer). */
export async function getLearnersAlsoTook(courseId: string, viewerId: string | null, limit = 4) {
  if (!viewerId || !await isRankingEnabled('suggestions', viewerId)) return null
  return marketplaceRepository.listLearnersAlsoTook(courseId, viewerId, { minShared: W.coEnrolMinShared, limit })
}
