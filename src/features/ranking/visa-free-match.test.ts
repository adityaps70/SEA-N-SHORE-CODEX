import { describe, expect, it } from 'vitest'
import { scoreJobMatch } from '@/features/jobs/matching'
import { scoreJobForMember } from './job-match'
import { VISA_SNAPSHOT_JOBS, VISA_SNAPSHOT_MEMBER, VISA_SNAPSHOT_TODAY } from './visa-free-match.fixtures'

/**
 * Hotfix P5: match scores for five sample jobs. The numbers are the ones each job scored before visa
 * left matching, with only the visa term removed: the three jobs without visas keep their exact old
 * scores (v2 100 / 77 / 89, round 12 100 / 64 / 30), and the "N/A" and US visa jobs now score what
 * they scored with no visa listed (v2 86 → 100 and 47 → 54; round 12 87 → 100 and 47 → 54).
 */
describe('visa-free match snapshot (hotfix P5)', () => {
  const snapshot = () => VISA_SNAPSHOT_JOBS.map((job) => {
    const { match } = scoreJobForMember(job, VISA_SNAPSHOT_MEMBER, VISA_SNAPSHOT_TODAY)
    return {
      id: job.id,
      score: match.score,
      band: match.band,
      roundTwelve: scoreJobMatch(job, VISA_SNAPSHOT_MEMBER, VISA_SNAPSHOT_TODAY).score,
      eligible: match.eligible,
      ineligibleReason: match.ineligibleReason,
    }
  })

  it('scores the five sample jobs as before, minus the visa term', () => {
    expect(snapshot()).toEqual([
      { id: 'rank-vessel-region', score: 100, band: 'strong', roundTwelve: 100, eligible: true, ineligibleReason: null },
      { id: 'na-visa', score: 100, band: 'strong', roundTwelve: 100, eligible: true, ineligibleReason: null },
      { id: 'us-visa', score: 54, band: 'partial', roundTwelve: 54, eligible: false, ineligibleReason: 'Not eligible: below this job’s minimum match (70%)' },
      { id: 'certificates-sea-time', score: 77, band: 'good', roundTwelve: 64, eligible: false, ineligibleReason: 'Not eligible: below this job’s minimum match (70%)' },
      { id: 'shore', score: 89, band: 'strong', roundTwelve: 30, eligible: false, ineligibleReason: 'Not eligible: below this job’s minimum match (70%)' },
    ])
  })

  it('a listed visa changes nothing: every sample scores the same with its visas taken away', () => {
    for (const job of VISA_SNAPSHOT_JOBS) {
      const stripped = { ...job, visaRequirements: [], visaList: [] }
      const withVisa = scoreJobForMember(job, VISA_SNAPSHOT_MEMBER, VISA_SNAPSHOT_TODAY).match
      const withoutVisa = scoreJobForMember(stripped, VISA_SNAPSHOT_MEMBER, VISA_SNAPSHOT_TODAY).match
      expect(withVisa, job.id).toEqual(withoutVisa)
      expect(scoreJobMatch(job, VISA_SNAPSHOT_MEMBER, VISA_SNAPSHOT_TODAY), job.id).toEqual(scoreJobMatch(stripped, VISA_SNAPSHOT_MEMBER, VISA_SNAPSHOT_TODAY))
      expect(JSON.stringify(withVisa), job.id).not.toMatch(/visa/i)
      // Whatever the member holds ("N/A", nothing, a real visa).
      for (const visas of [[], ['N/A'], ['US C1/D', 'Schengen']]) {
        expect(scoreJobForMember(job, { ...VISA_SNAPSHOT_MEMBER, visas }, VISA_SNAPSHOT_TODAY).match, `${job.id} ${visas.join(',')}`).toEqual(withVisa)
      }
    }
  })

  it('"Not eligible" never comes from visa', () => {
    for (const job of VISA_SNAPSHOT_JOBS) {
      expect(scoreJobForMember(job, { ...VISA_SNAPSHOT_MEMBER, visas: [] }, VISA_SNAPSHOT_TODAY).match.ineligibleReason ?? '').not.toMatch(/visa/i)
    }
  })
})
