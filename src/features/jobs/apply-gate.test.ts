import { describe, expect, it } from 'vitest'
import { applyGateError, evaluateApplyGate } from './apply-gate'
import type { JobMatchResult } from './types'

const job = { id: '11111111-1111-4111-8111-111111111111', minMatchToApply: 70 }
const match = (overrides: Partial<JobMatchResult> = {}): JobMatchResult => ({ score: 75, reasons: [], missingRequirements: [], warnings: [], profileGaps: [], ...overrides })

describe('apply gate (round 12)', () => {
  it('is open at or above the minimum and blocked below it', () => {
    expect(evaluateApplyGate(job, match({ score: 70 }))).toEqual({ status: 'open' })
    const below = evaluateApplyGate(job, match({ score: 52, missingRequirements: ['Master / Captain'] }))
    expect(below).toMatchObject({ status: 'below_minimum', message: 'Below this job’s minimum (70%) · you’re at 52%' })
    expect(applyGateError(below)).toBe('Below this job’s minimum (70%) · you’re at 52%. Missing: Master / Captain.')
  })

  it('lets anyone apply when the minimum is 0 or a shore job has nothing comparable', () => {
    expect(evaluateApplyGate({ ...job, minMatchToApply: 0 }, match({ score: 5, seaJobForOtherProfileType: true }))).toEqual({ status: 'open' })
    expect(evaluateApplyGate(job, match({ score: null }))).toEqual({ status: 'open' })
  })

  it('refuses a sea role to other profile types before anything else', () => {
    expect(evaluateApplyGate(job, match({ score: null, seaJobForOtherProfileType: true }))).toMatchObject({ status: 'sea_job_profile_type' })
  })

  it('asks for missing profile items before comparing with the minimum', () => {
    const gate = evaluateApplyGate(job, match({ score: 10, profileGaps: [{ key: 'certificates', label: 'Your certificates' }] }))
    expect(gate).toEqual({
      status: 'incomplete',
      message: 'Complete your profile to apply',
      gaps: [{ key: 'certificates', label: 'Your certificates', href: `/profile?edit=credential%3Anew&job=${job.id}` }],
    })
  })
})
