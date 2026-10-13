import type { PublicProfile } from '@/features/profiles/types'

export const RECOMMENDATION_WEIGHTS = {
  sharedVesselType: 6,
  sharedSkill: 5,
  sharedTradingArea: 4,
  rankMatch: 3,
  sameProfileType: 2,
  sameLocation: 1,
} as const

/**
 * Hotfix (round G): a connection request the viewer sent that is gone (declined or withdrawn)
 * keeps that member out of People you may know this long. social_action_events keeps
 * connection-request rows for SOCIAL_ACTION_RETENTION.connection_request (features/social/quotas.ts).
 */
export const DECLINED_REQUEST_SUGGESTION_WINDOW = '180 days'

/** How many suggestions each surface loads: the cards shown plus spares that slide in after Connect or dismiss. */
export const PEOPLE_SUGGESTION_LIMITS = {
  /** Home and profile rails show 3. */
  rail: 12,
  /** The phone feed row shows up to 10. */
  feedRow: 20,
  /** /network Discover shows a grid of up to 30. */
  discover: 40,
} as const

function normalize(value: string) {
  return value.trim().toLocaleLowerCase('en')
}

function normalizedSet(values: string[]) {
  return new Set(values.map(normalize).filter(Boolean))
}

function sharesValue(left: string[], right: string[]) {
  const values = normalizedSet(left)
  return right.some((value) => values.has(normalize(value)))
}

function sameOptionalValue(left: string | null, right: string | null) {
  return Boolean(left && right && normalize(left) === normalize(right))
}

export function scoreRecommendation(viewer: PublicProfile, candidate: PublicProfile): number {
  let score = 0

  if (sharesValue(viewer.vesselTypes, candidate.vesselTypes)) score += RECOMMENDATION_WEIGHTS.sharedVesselType
  if (sharesValue(viewer.skills, candidate.skills)) score += RECOMMENDATION_WEIGHTS.sharedSkill
  if (sharesValue(viewer.tradingAreas, candidate.tradingAreas)) score += RECOMMENDATION_WEIGHTS.sharedTradingArea
  if (sameOptionalValue(viewer.rank, candidate.rank)) score += RECOMMENDATION_WEIGHTS.rankMatch
  if (viewer.profileType === candidate.profileType) score += RECOMMENDATION_WEIGHTS.sameProfileType
  if (sameOptionalValue(viewer.location, candidate.location)) score += RECOMMENDATION_WEIGHTS.sameLocation

  return score
}
