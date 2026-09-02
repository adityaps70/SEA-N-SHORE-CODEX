import type { PublicProfile } from '@/features/profiles/types'

export const RECOMMENDATION_WEIGHTS = {
  sharedVesselType: 6,
  sharedSkill: 5,
  sharedTradingArea: 4,
  rankMatch: 3,
  sameProfileType: 2,
  sameLocation: 1,
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
