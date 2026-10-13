/**
 * Round G (G1): every weight and threshold of the "Top for you" feed. Change the numbers here and
 * bump FEED_WEIGHTS_VERSION; tests check order and exclusions, not exact scores.
 *
 * Score = relationship × (0.6 + relevance) × engagement quality × freshness × penalties
 */
export const FEED_WEIGHTS_VERSION = 'feed-2026-10-13.1'

export const FEED_WEIGHTS = {
  candidates: {
    /** Look back this many days, widening while fewer than minCandidates are found. */
    windowsDays: [7, 14, 30] as const,
    /** When the viewer has seen everything, these wider windows are tried next. */
    fallbackWindowsDays: [90, 180] as const,
    minCandidates: 60,
    /** Upper bound on rows the candidate query returns. */
    maxCandidates: 500,
    /** The member's own new post stays on top this long. */
    ownPostPinMinutes: 10,
  },
  relationship: {
    connection: 1.0,
    followedPerson: 0.85,
    followedOrg: 0.75,
    community: 0.7,
    secondDegree: 0.45,
    discovery: 0.3,
    /** Extra for authors the viewer engaged with recently, up to this much. */
    recentEngagementMax: 0.5,
    recentEngagementPerAction: 0.1,
    recentEngagementDays: 30,
  },
  relevance: {
    max: 0.6,
    /** Category affinity from the viewer's reactions and comments in this many days. */
    affinityDays: 60,
    categoryAffinityMax: 0.25,
    sameDepartmentOrRankBand: 0.15,
    sameVesselGroup: 0.1,
    sameTradingArea: 0.05,
    sameCompany: 0.1,
    learningForStudents: 0.15,
  },
  engagement: {
    commentWeight: 3,
    repostWeight: 2,
    reactionWeight: 1,
    /** Engagement from the viewer's connections counts this many times. */
    connectionMultiplier: 2,
    /** Smoothing: hours added to the age, and a prior added to the engagement. */
    smoothingHours: 2,
    prior: 1,
    /** quality = 1 + logScale × log1p(per-hour rate), capped. */
    logScale: 0.35,
    cap: 2.5,
  },
  freshness: {
    halfLifeHours: 24,
    /** Freshness never drops below this for a close relationship (connection, followed person), so a strong 3-day-old post can still show. */
    closeFloor: 0.25,
    otherFloor: 0.05,
  },
  penalties: {
    showLess: 0.3,
    pendingReport: 0.2,
    newAccountSpam: 0.5,
    newAccountDays: 7,
    newAccountPostsPerDay: 5,
    linkOnlyOrEmpty: 0.6,
    /** A post served in the previous visit but not seen drops to here and below position `servedNotSeenFloorPosition`. */
    servedNotSeen: 0.5,
    servedNotSeenFloorPosition: 5,
  },
  diversity: {
    maxPerAuthorPerTen: 2,
    maxSameCategoryRun: 3,
  },
  mixing: {
    peopleRowEvery: 8,
    jobsCardEvery: 15,
    maxInsertsPerEight: 1,
  },
  coldStart: {
    maxGraphSize: 4,
  },
  session: {
    ttlMinutes: 15,
    pageSize: 12,
    /** Posts ranked into one snapshot. */
    snapshotSize: 120,
  },
  newPostsPollSeconds: 60,
} as const
