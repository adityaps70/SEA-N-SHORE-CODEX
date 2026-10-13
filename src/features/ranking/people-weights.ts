/**
 * Round G (G2): every weight of People you may know. Change the numbers here and bump
 * PEOPLE_WEIGHTS_VERSION; tests check order and exclusions, not exact scores.
 */
export const PEOPLE_WEIGHTS_VERSION = 'people-2026-10-13.1'

export const PEOPLE_WEIGHTS = {
  sources: {
    mutualConnection: 4,
    mutualConnectionCap: 24,
    shipmate: 18,
    sameCurrentCompany: 12,
    samePastCompany: 6,
    pastCompanyOverlapBonus: 2,
    sameInstitution: 8,
    sameInstitutionYearBonus: 2,
    sharedCommunityOrOrg: 4,
    sameEvent: 3,
    sameCourse: 1,
    rankWithinOneStep: 4,
    rankWithinTwoSteps: 2,
    sameVesselGroup: 4,
    sameTradingArea: 2,
    sameCity: 3,
    sameCountry: 1,
    complementaryPersona: 3,
  },
  multipliers: {
    activeWithin30Days: 1.0,
    activeWithin90Days: 0.7,
    inactive: 0.4,
    completeProfile: 1.0,
    incompleteProfile: 0.75,
    newMember: 1.15,
    newMemberDays: 14,
  },
  diversity: {
    topN: 5,
    maxSameCompanyInTop: 2,
    minSourcesInTop: 2,
  },
  /** Rows kept per member in people_suggestions. */
  keepPerViewer: 60,
  dismissDays: 180,
  declinedRequestDays: 180,
  /** Minimum score for a precomputed row. */
  minScore: 1,
} as const
