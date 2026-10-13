import { roleByKey } from '@/features/roles/taxonomy'
import { VESSEL_GROUP_LABELS, rankDistance, vesselGroupsOf } from '@/features/taxonomy/maritime-taxonomy'
import type { PeopleCandidateFeatures, PeopleViewer } from './people-candidates'
import { PEOPLE_WEIGHTS } from './people-weights'
import { roundScore, type RankReason, type Scored } from './types'

/**
 * Round G (G2): the People you may know scorer. Pure: features in, score and reasons out.
 * Reasons are stored as codes with only the details the viewer can already see on the
 * candidate's profile; events and courses add points but never become the reason line (who
 * attended or enrolled is not always visible).
 */
const W = PEOPLE_WEIGHTS

export const PEOPLE_SECTIONS = ['mutual', 'shipmate', 'company', 'institution', 'similar'] as const
export type PeopleSection = (typeof PEOPLE_SECTIONS)[number]

export const PEOPLE_SECTION_LABELS: Record<PeopleSection, string> = {
  mutual: 'Mutual connections',
  shipmate: 'Shipmates',
  company: 'From your company',
  institution: 'From your institute',
  similar: 'Similar rank',
}

export type StoredReason =
  | { code: 'mutual'; count: number }
  | { code: 'shipmate'; vessel: string | null }
  | { code: 'company'; name: string }
  | { code: 'past_company'; name: string }
  | { code: 'institution'; name: string }
  | { code: 'community'; name: string | null; count: number }
  | { code: 'organization'; count: number }
  | { code: 'rank'; roleKey: string; same: boolean }
  | { code: 'vessel_group'; group: string }
  | { code: 'city'; city: string }
  | { code: 'persona'; persona: string }
  | { code: 'profile' }

function city(location: string | null) {
  return location?.split(',')[0]?.trim().toLocaleLowerCase() || null
}

function country(location: string | null) {
  const parts = location?.split(',').map((part) => part.trim()).filter(Boolean) ?? []
  return parts.length > 1 ? parts.at(-1)!.toLocaleLowerCase() : null
}

function overlaps(left: readonly string[], right: readonly string[]) {
  const set = new Set(left.map((value) => value.toLocaleLowerCase()))
  return right.some((value) => set.has(value.toLocaleLowerCase()))
}

/** The plain reason line for a card. `vessel` is null when the vessel is not shown on both profiles. */
export function reasonText(reason: StoredReason): string {
  switch (reason.code) {
    case 'mutual': return `${reason.count} mutual connection${reason.count === 1 ? '' : 's'}`
    case 'shipmate': return reason.vessel ? `Sailed on ${reason.vessel} together` : 'You may have sailed together'
    case 'company': return `Also at ${reason.name}`
    case 'past_company': return `Also worked at ${reason.name}`
    case 'institution': return `Same institute: ${reason.name}`
    case 'community': return reason.name ? `Also in ${reason.name}` : 'In a community you’re in'
    case 'organization': return 'In an organization you belong to'
    case 'rank': {
      const label = roleByKey(reason.roleKey)?.label ?? 'a similar rank'
      return reason.same ? `Also a ${label}` : `Similar rank: ${label}`
    }
    case 'vessel_group': return `Also sails on ${VESSEL_GROUP_LABELS[reason.group as keyof typeof VESSEL_GROUP_LABELS]?.toLocaleLowerCase() ?? 'similar vessels'}`
    case 'city': return `Also in ${reason.city}`
    case 'persona': return reason.persona === 'trainer_instructor' ? 'Trainer for your department' : 'Recruits for your department'
    default: return 'Suggested from your profile'
  }
}

export type PeopleScore = Scored<PeopleCandidateFeatures> & { primarySource: PeopleSection | 'community' | 'other'; stored: StoredReason[] }

export function scorePeopleCandidate(candidate: PeopleCandidateFeatures, viewer: PeopleViewer): PeopleScore {
  const s = W.sources
  const parts: Record<string, number> = {}
  const stored: Array<{ reason: StoredReason; points: number; source: PeopleScore['primarySource'] }> = []
  const add = (key: string, points: number, reason: StoredReason | null, source: PeopleScore['primarySource']) => {
    if (points <= 0) return
    parts[key] = (parts[key] ?? 0) + points
    if (reason) stored.push({ reason, points, source })
  }

  if (candidate.mutualCount > 0) add('mutual', Math.min(s.mutualConnectionCap, candidate.mutualCount * s.mutualConnection), { code: 'mutual', count: candidate.mutualCount }, 'mutual')
  // Profiles and their sea service are visible to every signed-in member, so a matched vessel name can be shown;
  // when the vessel matched without a name on both sides (future: IMO number), the line stays generic.
  if (candidate.shipmate) add('shipmate', s.shipmate, { code: 'shipmate', vessel: candidate.shipmateVessel }, 'shipmate')
  if (candidate.sameCurrentCompany) add('company', s.sameCurrentCompany, { code: 'company', name: candidate.sameCurrentCompany }, 'company')
  else if (candidate.pastCompany) add('past_company', s.samePastCompany + (candidate.pastCompanyOverlapYears > 0 ? s.pastCompanyOverlapBonus : 0), { code: 'past_company', name: candidate.pastCompany }, 'company')
  if (candidate.sameInstitution) add('institution', s.sameInstitution, { code: 'institution', name: candidate.sameInstitution }, 'institution')
  if (candidate.sharedCommunities > 0) add('community', s.sharedCommunityOrOrg * Math.min(candidate.sharedCommunities, 2), { code: 'community', name: candidate.sharedCommunityName, count: candidate.sharedCommunities }, 'community')
  if (candidate.sharedOrganizations > 0) add('organization', s.sharedCommunityOrOrg, { code: 'organization', count: candidate.sharedOrganizations }, 'company')
  if (candidate.sharedEvents > 0) add('event', s.sameEvent, null, 'other')
  if (candidate.sharedCourses > 0) add('course', s.sameCourse, null, 'other')

  const distance = rankDistance(viewer.roleKey, candidate.roleKey)
  if (distance !== null && distance <= 1) add('rank', s.rankWithinOneStep, { code: 'rank', roleKey: candidate.roleKey!, same: distance === 0 }, 'similar')
  else if (distance !== null && distance <= 2) add('rank', s.rankWithinTwoSteps, { code: 'rank', roleKey: candidate.roleKey!, same: false }, 'similar')
  const sharedGroups = vesselGroupsOf(viewer.vesselCodes).filter((group) => vesselGroupsOf(candidate.vesselCodes).includes(group))
  if (sharedGroups.length) add('vessel_group', s.sameVesselGroup, { code: 'vessel_group', group: sharedGroups[0]! }, 'similar')
  if (overlaps(viewer.tradingAreas, candidate.tradingAreas)) add('trading_area', s.sameTradingArea, null, 'similar')
  const viewerCity = city(viewer.location)
  if (viewerCity && viewerCity === city(candidate.location)) add('city', s.sameCity, { code: 'city', city: candidate.location!.split(',')[0]!.trim() }, 'other')
  else if (country(viewer.location) && country(viewer.location) === country(candidate.location)) add('country', s.sameCountry, null, 'other')
  // Complementary personas, used sparingly: cadets see a few trainers and recruiters.
  if (viewer.persona === 'student_cadet' && (candidate.persona === 'trainer_instructor' || candidate.persona === 'recruiter_hr')) {
    add('persona', s.complementaryPersona, { code: 'persona', persona: candidate.persona }, 'other')
  }

  const base = Object.values(parts).reduce((sum, value) => sum + value, 0)
  const m = W.multipliers
  const activity = candidate.lastActiveDaysAgo <= 30 ? m.activeWithin30Days : candidate.lastActiveDaysAgo <= 90 ? m.activeWithin90Days : m.inactive
  const quality = candidate.hasPhoto && candidate.hasHeadline ? m.completeProfile : m.incompleteProfile
  const fresh = candidate.joinedDaysAgo <= m.newMemberDays ? m.newMember : 1
  const score = base * activity * quality * fresh

  stored.sort((left, right) => right.points - left.points)
  const primarySource = stored[0]?.source ?? 'other'
  const reasons: RankReason[] = stored.slice(0, 2).map(({ reason }) => ({ code: reason.code, text: reasonText(reason) }))
  return {
    item: candidate,
    score: roundScore(score),
    reasons,
    parts: { ...parts, activity, quality, fresh },
    primarySource,
    stored: stored.slice(0, 3).map(({ reason }) => reason),
  }
}

/**
 * Top-5 diversity: at most 2 from the same company, and at least two different sources when
 * possible. The rest keeps its score order.
 */
export function diversifyPeople<T extends { score: number; primarySource: string; companyKey: string | null }>(entries: readonly T[]): T[] {
  const ordered = [...entries].sort((left, right) => right.score - left.score)
  const top: T[] = []
  const rest: T[] = []
  for (const entry of ordered) {
    if (top.length >= W.diversity.topN) {
      rest.push(entry)
      continue
    }
    const sameCompany = entry.companyKey ? top.filter((other) => other.companyKey === entry.companyKey).length : 0
    if (sameCompany >= W.diversity.maxSameCompanyInTop) {
      rest.push(entry)
      continue
    }
    top.push(entry)
  }
  // Mix sources: if the top 5 is all one source, swap the last one for the best of another source.
  const sources = new Set(top.map((entry) => entry.primarySource))
  if (top.length === W.diversity.topN && sources.size < W.diversity.minSourcesInTop) {
    const swapIndex = rest.findIndex((entry) => !sources.has(entry.primarySource))
    if (swapIndex !== -1) {
      const [swap] = rest.splice(swapIndex, 1)
      rest.unshift(top.pop()!)
      top.push(swap!)
    }
  }
  return [...top, ...rest.sort((left, right) => right.score - left.score)]
}
