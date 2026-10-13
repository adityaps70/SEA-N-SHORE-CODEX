/**
 * Round G (G3): every weight and threshold of the jobs match (Jobs for you, job alerts, recruiter
 * Best match and Suggested candidates). Change the numbers here and bump JOB_WEIGHTS_VERSION; tests
 * check eligibility and order, not exact scores.
 */
export const JOB_WEIGHTS_VERSION = 'jobs-2026-10-13.1'

export const JOB_WEIGHTS = {
  /** Points per criterion. A criterion counts only when the job specifies it. */
  criteria: {
    rankExact: 25,
    rankOneStep: 15,
    vessel: 20,
    certificates: 20,
    seaTime: 15,
    availability: 10,
    skills: 10,
    visas: 10,
    tradingArea: 5,
    location: 5,
  },
  /** Share of a criterion's points. */
  credit: {
    vesselSameGroup: 0.5,
    certificateVerified: 1,
    certificateSelfReported: 0.75,
    availabilityWithinGrace: 0.5,
    locationSameCountry: 0.5,
  },
  /** Days after the joining window a member's "available from" still earns partial credit. */
  availabilityGraceDays: 30,
  /** A job with only a joining-from date is treated as joining within this many days of it. */
  joiningWindowDays: 30,
  /** Words from a shore job's title and requirements that must appear for full skills credit. */
  skillsWordsForFull: 3,
  /**
   * The score is multiplied by this factor for the number of criteria the job specifies, so a job
   * with 0 or 1 criteria can never be Strong (a single matching field proves little).
   */
  specificity: { 1: 0.75, 2: 0.9, 3: 1 } as Record<number, number>,
  bands: { strong: 80, good: 60, partial: 40 },
  /** Freshness: a job's ordering weight halves every this many days after it is published. */
  freshnessHalfLifeDays: 14,
  /** Ordering stand-in for jobs that cannot be scored (nothing comparable): just below Partial. */
  unscoredBaseline: 30,
  pool: {
    /** Jobs For you scores at most this many after the SQL prefilter. */
    maxScored: 300,
    pageSize: 20,
  },
  alerts: {
    maxJobsPerEmail: 10,
    /** A Strong match push for a brand-new job, at most once a day per member. */
    strongPushPerDay: 1,
    /** "Brand-new" for the push: published within this many hours. */
    strongPushNewHours: 24,
    /** Alerts send from this hour (UTC) onwards; 02:00 UTC is 07:30 IST. */
    sendHourUtc: 2,
    /** Weekly alerts send on this weekday (0 = Sunday). */
    weeklyDay: 1,
    batchSize: 50,
  },
  recruiters: {
    suggestedCandidates: 20,
    /** Best match applicants list sorts at most this many by score (older ones follow by date). */
    maxScoredApplicants: 500,
  },
} as const

export function specificityFactor(criteria: number): number {
  if (criteria <= 0) return 0
  return JOB_WEIGHTS.specificity[Math.min(criteria, 3)] ?? 1
}

/** 1 at publication, 0.5 after one half-life. */
export function jobFreshness(publishedAt: string | null | undefined, now: Date): number {
  const time = publishedAt ? Date.parse(publishedAt) : Number.NaN
  if (!Number.isFinite(time)) return 1
  const ageDays = Math.max(0, (now.getTime() - time) / 86_400_000)
  return Math.pow(0.5, ageDays / JOB_WEIGHTS.freshnessHalfLifeDays)
}
