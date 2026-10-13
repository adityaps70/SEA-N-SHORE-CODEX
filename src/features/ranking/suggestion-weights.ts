/**
 * Round G (G5): every weight of the organization, community, event and course suggestions. Change
 * the numbers here and bump SUGGESTION_WEIGHTS_VERSION; tests check exclusions and order, not scores.
 */
export const SUGGESTION_WEIGHTS_VERSION = 'suggestions-2026-10-13.1'

export const SUGGESTION_WEIGHTS = {
  orgs: {
    currentCompany: 40,
    pastCompany: 25,
    connectionWorksHere: 6,
    connectionWorksHereCap: 30,
    connectionFollows: 3,
    connectionFollowsCap: 15,
    openJobsForYou: 15,
    trainingForCadets: 20,
    verified: 5,
    /** ln(1 + followers) × this. */
    popularity: 1,
    /** "People who follow this page also follow": shared followers needed. */
    coFollowMinShared: 3,
  },
  communities: {
    personaOrRank: 20,
    connectionMember: 5,
    connectionMemberCap: 25,
    linkedToFollowedOrg: 15,
    /** ln(1 + members) × this. */
    popularity: 2,
  },
  events: {
    windowDays: 60,
    hostFollowedOrConnected: 30,
    connectionAttending: 5,
    connectionAttendingCap: 20,
    topicMatch: 10,
    sameCity: 15,
    sameCountry: 8,
    online: 4,
  },
  courses: {
    refresherMonths: 6,
    refresher: 40,
    rankBand: 20,
    careerStep: 15,
    popularInRankBand: 3,
    popularInRankBandCap: 15,
    popularityDays: 90,
    /** "Learners also took": shared learners needed. */
    coEnrolMinShared: 3,
  },
} as const

/** Learn category labels and the rank department or vessel group each one serves. */
export const COURSE_CATEGORY_DEPARTMENTS: Record<string, readonly string[]> = {
  deck: ['deck'],
  engine: ['engine', 'electrical'],
  tankers: ['deck', 'engine'],
  'lng lpg': ['deck', 'engine'],
  offshore: ['deck', 'engine'],
  'sire 2 0': ['deck'],
  safety: ['deck', 'engine', 'electrical', 'catering'],
  leadership: ['deck', 'engine', 'electrical', 'shore'],
  'shore careers': ['shore'],
  'maritime law': ['shore'],
  'human factors': ['deck', 'engine', 'electrical', 'catering', 'shore'],
}

/** Event categories that suit a rank department (shore ranks match the career and regulatory ones). */
export const EVENT_CATEGORY_DEPARTMENTS: Record<string, readonly string[]> = {
  training: ['deck', 'engine', 'electrical', 'catering'],
  safety: ['deck', 'engine', 'electrical', 'catering'],
  technical: ['deck', 'engine', 'electrical'],
  regulatory: ['deck', 'engine', 'shore'],
  careers: ['deck', 'engine', 'electrical', 'catering', 'shore'],
  leadership: ['deck', 'engine', 'shore'],
  networking: ['shore'],
  community: [],
}
