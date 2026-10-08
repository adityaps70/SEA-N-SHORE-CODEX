import { describe, expect, it } from 'vitest'
import { scoreJobMatch } from './matching'
import { jobMatchDisplay } from './match-display'
import type { JobCandidateProfile, JobListing } from './types'

const job: JobListing = {
  id: 'job-1',
  title: 'Chief Officer',
  companyName: 'Oceanic Ship Management',
  companyId: 'company-1',
  companySlug: 'oceanic-ship-management',
  companyVerified: true,
  recruiterVerified: true,
  location: 'Worldwide',
  summary: 'Oil tanker opportunity',
  description: 'Join a managed oil tanker fleet.',
  requirements: 'Chief Officer with tanker background.',
  applyUntil: '2026-10-01',
  createdAt: '2026-09-10T10:00:00.000Z',
  publishedAt: '2026-09-10T10:00:00.000Z',
  domain: 'sea',
  department: 'Deck',
  rank: 'Chief Officer',
  vesselTypes: ['Oil Tanker'],
  experienceMinYears: 4,
  experienceMaxYears: null,
  joiningFrom: '2026-09-20',
  joiningUntil: '2026-09-30',
  salaryMin: 7800,
  salaryMax: 8400,
  salaryCurrency: 'USD',
  salaryPeriod: 'month',
  regions: ['Worldwide'],
  certificateRequirements: ['STCW', 'Advanced Oil Tanker'],
  visaRequirements: ['US C1/D'],
  urgent: true,
  easyApply: true,
}

const profile: JobCandidateProfile = {
  persona: 'seafarer',
  roleKey: 'chief_officer',
  rank: 'Chief Officer',
  sailingExperienceYears: 7,
  vesselTypes: ['Oil Tanker', 'Chemical Tanker'],
  tradingAreas: ['Worldwide', 'Middle East'],
  availability: '2026-09-18',
  certificates: [
    { name: 'STCW', expiresAt: '2028-01-01', verified: true },
    { name: 'Advanced Oil Tanker', expiresAt: '2027-04-01', verified: true },
  ],
  visas: ['US C1/D'],
  shoreCareerPreference: false,
  skills: ['Leadership', 'Cargo Operations'],
}

describe('Your Maritime Match', () => {
  it('returns a high explainable match when the profile satisfies maritime requirements', () => {
    const result = scoreJobMatch(job, profile, new Date('2026-09-11T00:00:00.000Z'))

    expect(result.score).toBeGreaterThanOrEqual(95)
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining('rank'),
      expect.stringContaining('vessel'),
      expect.stringContaining('certificate'),
    ]))
    expect(result.missingRequirements).toEqual([])
  })

  it('treats availability as unknown: an old stored value neither helps nor warns', () => {
    const today = new Date('2026-09-11T00:00:00.000Z')
    const withOldValue = scoreJobMatch(job, { ...profile, availability: '2027-12-01' }, today)
    const withoutValue = scoreJobMatch(job, { ...profile, availability: null }, today)

    expect(withOldValue.score).toBe(withoutValue.score)
    expect(withOldValue.warnings.join(' ')).not.toMatch(/availability/i)
    expect(withOldValue.reasons.join(' ')).not.toMatch(/availability/i)
  })

  it('surfaces missing visas and expired credentials as eligibility warnings', () => {
    const result = scoreJobMatch(job, {
      ...profile,
      visas: [],
      certificates: [
        { name: 'STCW', expiresAt: '2026-08-01', verified: true },
        { name: 'Advanced Oil Tanker', expiresAt: '2027-04-01', verified: true },
      ],
    }, new Date('2026-09-11T00:00:00.000Z'))

    expect(result.score).toBeLessThan(95)
    expect(result.missingRequirements).toEqual(expect.arrayContaining(['US C1/D', 'STCW']))
    expect(result.warnings.join(' ')).toMatch(/visa/i)
    expect(result.warnings.join(' ')).toMatch(/expired/i)
  })

  it('does not recommend a sea job as a strong fit when current rank and vessel experience miss', () => {
    const result = scoreJobMatch(job, {
      ...profile,
      roleKey: 'third_officer',
      rank: 'Third Officer',
      vesselTypes: ['Bulk Carrier'],
    }, new Date('2026-09-11T00:00:00.000Z'))

    expect(result.score).toBeLessThan(75)
    expect(result.missingRequirements).toEqual(expect.arrayContaining(['Chief Officer', 'Oil Tanker']))
  })
})

const today = new Date('2026-09-11T00:00:00.000Z')

/** A sea job asking only for what each test sets. */
function seaJob(overrides: Partial<JobListing> = {}): JobListing {
  return {
    ...job,
    title: 'Master',
    department: 'Deck officers',
    rank: 'Master / Captain',
    departmentKey: 'deck_officers',
    acceptedRoleKeys: ['master'],
    vesselTypes: [],
    experienceMinYears: null,
    regions: [],
    certificateRequirements: [],
    visaRequirements: [],
    ...overrides,
  }
}

function seafarer(overrides: Partial<JobCandidateProfile> = {}): JobCandidateProfile {
  return {
    persona: 'seafarer',
    rank: null,
    sailingExperienceYears: null,
    vesselTypes: [],
    tradingAreas: [],
    availability: null,
    certificates: [],
    visas: [],
    shoreCareerPreference: false,
    skills: [],
    ...overrides,
  }
}

describe('Your Maritime Match (round 12)', () => {
  it('gives a Maritime Enthusiast web developer no match on a Master sea job, with a quiet line instead', () => {
    const result = scoreJobMatch(seaJob(), seafarer({ persona: 'maritime_enthusiast', occupationText: 'Web developer', skills: ['TypeScript'] }), today)
    expect(result.score).toBeNull()
    expect(result.band).toBeNull()
    expect(result.seaJobForOtherProfileType).toBe(true)
    expect(result.notice).toBe('Sea-going role. Your profile type is Maritime Enthusiast.')
    expect(jobMatchDisplay(result)).toBeNull()
  })

  it('scores a Cook at most 20 for a Master job: Low match, missing the rank', () => {
    const result = scoreJobMatch(seaJob({ vesselTypes: ['Oil Tanker'] }), seafarer({ roleKey: 'cook', vesselTypes: ['Oil Tanker'] }), today)
    expect(result.score).toBeLessThanOrEqual(20)
    expect(result.band).toBe('low')
    expect(jobMatchDisplay(result)?.text).toBe('Low match')
    expect(result.missingRequirements).toContain('Master / Captain')
  })

  it('caps a Chief Officer at 60 for a Master job and says the rank is missing', () => {
    const result = scoreJobMatch(
      seaJob({ vesselTypes: ['Oil Tanker'], experienceMinYears: 5, certificateRequirements: ['STCW'] }),
      seafarer({ roleKey: 'chief_officer', vesselTypes: ['Oil Tanker'], sailingExperienceYears: 9, certificates: [{ name: 'STCW', expiresAt: null, verified: true }] }),
      today,
    )
    expect(result.score).toBeLessThanOrEqual(60)
    expect(result.score).toBeGreaterThan(20)
    expect(result.missingRequirements).toContain('Master / Captain')
  })

  it('gives a Master with matching vessel, years and verified certificates a Strong match', () => {
    const result = scoreJobMatch(
      seaJob({ vesselTypes: ['Oil Tanker'], experienceMinYears: 10, certificateRequirements: ['STCW', 'Advanced Oil Tanker'] }),
      seafarer({
        roleKey: 'master',
        vesselTypes: ['Oil Tanker'],
        sailingExperienceYears: 18,
        certificates: [
          { name: 'STCW', expiresAt: '2030-01-01', verified: true },
          { name: 'Advanced Oil Tanker', expiresAt: '2030-01-01', verified: true },
        ],
      }),
      today,
    )
    expect(result.score).toBeGreaterThanOrEqual(80)
    expect(result.band).toBe('strong')
    expect(jobMatchDisplay(result)?.text).toBe(`Strong match · ${result.score}%`)
  })

  it('gives a Chief Officer full rank credit on a job that accepts Master and Chief Officer', () => {
    const result = scoreJobMatch(seaJob({ acceptedRoleKeys: ['master', 'chief_officer'] }), seafarer({ roleKey: 'chief_officer' }), today)
    expect(result.score).toBe(100)
    expect(result.missingRequirements).toEqual([])
  })

  it('gives full credit one level more senior, and half credit (capped at 60) one level below the most junior accepted rank', () => {
    expect(scoreJobMatch(seaJob({ acceptedRoleKeys: ['chief_officer'] }), seafarer({ roleKey: 'master' }), today).score).toBe(100)
    const below = scoreJobMatch(seaJob({ acceptedRoleKeys: ['master', 'chief_officer'] }), seafarer({ roleKey: 'second_officer' }), today)
    expect(below.score).toBe(50)
    expect(below.missingRequirements).toEqual(['Chief Officer'])
  })

  it('compares a Deck Cadet with their target role: targeting Third Officer matches a Third Officer job', () => {
    const cadet = seafarer({ persona: 'student_cadet', cadetStageKey: 'deck_cadet', targetRoleKey: 'third_officer', rank: null })
    expect(scoreJobMatch(seaJob({ acceptedRoleKeys: ['third_officer'] }), cadet, today).score).toBe(100)
    // A cadet job still matches the cadet rank they hold.
    expect(scoreJobMatch(seaJob({ acceptedRoleKeys: ['deck_cadet'] }), cadet, today).score).toBe(100)
  })

  it('gives no free points for blank criteria, and no match when nothing comparable is specified', () => {
    const rankOnly = scoreJobMatch(seaJob(), seafarer({ roleKey: 'master' }), today)
    expect(rankOnly.score).toBe(100)
    const missesVessel = scoreJobMatch(seaJob({ vesselTypes: ['LNG'] }), seafarer({ roleKey: 'master', vesselTypes: ['Bulk Carrier'] }), today)
    expect(missesVessel.score).toBe(Math.round((35 / 50) * 100))
    const nothing = scoreJobMatch(seaJob({ acceptedRoleKeys: [], rank: null, departmentKey: null, regions: ['Worldwide'] }), seafarer({ roleKey: 'master' }), today)
    expect(nothing.score).toBeNull()
    expect(jobMatchDisplay(nothing)).toBeNull()
  })

  it('treats "Worldwide" and blank regions as not specified and no longer adds free availability or career points', () => {
    const base = scoreJobMatch(seaJob({ vesselTypes: ['LNG'] }), seafarer({ roleKey: 'master' }), today)
    const worldwide = scoreJobMatch(seaJob({ vesselTypes: ['LNG'], regions: ['Worldwide'] }), seafarer({ roleKey: 'master', availability: 'Now', shoreCareerPreference: false }), today)
    expect(worldwide.score).toBe(base.score)
    expect(base.score).toBe(70)
  })

  it('gives an "Other" rank no rank credit', () => {
    const result = scoreJobMatch(seaJob(), seafarer({ roleKey: 'other_deck_officers', roleOtherText: 'Ice Navigator' }), today)
    expect(result.score).toBeLessThanOrEqual(20)
    expect(result.profileGaps).toEqual([])
  })

  it('falls back to the old rank text on profiles and jobs without keys', () => {
    const legacyJob = seaJob({ departmentKey: null, acceptedRoleKeys: [], rank: 'Captain', domain: 'sea' })
    expect(scoreJobMatch(legacyJob, seafarer({ rank: 'Master Mariner' }), today).score).toBe(100)
    expect(scoreJobMatch(legacyJob, seafarer({ rank: 'C/O' }), today).score).toBe(50)
    const unknown = scoreJobMatch(legacyJob, seafarer({ rank: 'Sea wizard' }), today)
    expect(unknown.score).toBeLessThanOrEqual(20)
    expect(unknown.profileGaps).toEqual([{ key: 'rank', label: 'Your current or most recent rank' }])
  })

  it('lists the profile data the job asks for that the member has not added', () => {
    const result = scoreJobMatch(
      seaJob({ certificateRequirements: ['STCW'], experienceMinYears: 5, vesselTypes: ['Oil Tanker'] }),
      seafarer({ roleKey: null, rank: null }),
      today,
    )
    expect(result.profileGaps?.map((gap) => gap.key)).toEqual(['rank', 'sea_time', 'vessel_types', 'certificates'])
  })

  it('matches shore jobs for every profile type, by title words when the job has no accepted roles', () => {
    const shoreJob = seaJob({ title: 'Marine Superintendent', domain: 'shore', departmentKey: null, acceptedRoleKeys: [], rank: null, department: null })
    const enthusiast = seafarer({ persona: 'maritime_enthusiast', experienceTitles: ['Marine Superintendent'] })
    expect(scoreJobMatch(shoreJob, enthusiast, today).score).toBe(100)
    expect(scoreJobMatch(shoreJob, seafarer({ persona: 'maritime_enthusiast', occupationText: 'Web developer' }), today).score).toBe(0)

    const keyedShore = seaJob({ domain: 'shore', departmentKey: 'technical_fleet', acceptedRoleKeys: ['technical_superintendent'] })
    expect(scoreJobMatch(keyedShore, seafarer({ persona: 'shore_professional', roleKey: 'technical_superintendent' }), today).score).toBe(100)
    expect(scoreJobMatch(keyedShore, seafarer({ persona: 'maritime_enthusiast' }), today).score).toBeLessThanOrEqual(20)
  })
})

describe('match display bands (round 12)', () => {
  const result = (score: number | null) => ({ score, reasons: [], missingRequirements: [], warnings: [] })

  it('shows no badge for no match and no % below 40', () => {
    expect(jobMatchDisplay(null)).toBeNull()
    expect(jobMatchDisplay(result(null))).toBeNull()
    expect(jobMatchDisplay(result(39))).toMatchObject({ band: 'low', text: 'Low match', showInList: false })
  })

  it('labels each band with its %', () => {
    expect(jobMatchDisplay(result(52))?.text).toBe('Partial match · 52%')
    expect(jobMatchDisplay(result(68))?.text).toBe('Good match · 68%')
    expect(jobMatchDisplay(result(86))?.text).toBe('Strong match · 86%')
    expect(jobMatchDisplay(result(40))?.showInList).toBe(true)
  })
})
