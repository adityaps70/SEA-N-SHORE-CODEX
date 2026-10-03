import { describe, expect, it } from 'vitest'
import {
  evaluateMaterialAvailability,
  normalizeAttemptLimit,
  shouldCompleteMaterial,
} from './lms-material-policy'

const now = new Date('2026-09-15T12:00:00.000Z')
const enrolledAt = new Date('2026-09-10T12:00:00.000Z')

describe('evaluateMaterialAvailability', () => {
  it('locks unpublished materials', () => {
    expect(evaluateMaterialAvailability({
      isPublished: false,
      releaseMode: 'immediate',
      releaseAt: null,
      dripDelayDays: null,
      enrolledAt,
      now,
      prerequisiteRequired: false,
      prerequisiteCompleted: false,
    })).toEqual({ available: false, reason: 'unpublished' })
  })

  it('locks scheduled materials until release time', () => {
    expect(evaluateMaterialAvailability({
      isPublished: true,
      releaseMode: 'scheduled',
      releaseAt: new Date('2026-09-16T12:00:00.000Z'),
      dripDelayDays: null,
      enrolledAt,
      now,
      prerequisiteRequired: false,
      prerequisiteCompleted: false,
    })).toEqual({ available: false, reason: 'scheduled' })
  })

  it('unlocks scheduled materials after release time', () => {
    expect(evaluateMaterialAvailability({
      isPublished: true,
      releaseMode: 'scheduled',
      releaseAt: new Date('2026-09-14T12:00:00.000Z'),
      dripDelayDays: null,
      enrolledAt,
      now,
      prerequisiteRequired: false,
      prerequisiteCompleted: false,
    })).toEqual({ available: true, reason: null })
  })

  it('locks drip materials until enrollment age reaches delay', () => {
    expect(evaluateMaterialAvailability({
      isPublished: true,
      releaseMode: 'drip',
      releaseAt: null,
      dripDelayDays: 7,
      enrolledAt,
      now,
      prerequisiteRequired: false,
      prerequisiteCompleted: false,
    })).toEqual({ available: false, reason: 'drip' })
  })

  it('locks otherwise released materials when prerequisite is incomplete', () => {
    expect(evaluateMaterialAvailability({
      isPublished: true,
      releaseMode: 'immediate',
      releaseAt: null,
      dripDelayDays: null,
      enrolledAt,
      now,
      prerequisiteRequired: true,
      prerequisiteCompleted: false,
    })).toEqual({ available: false, reason: 'prerequisite' })
  })
})

describe('shouldCompleteMaterial', () => {
  it('supports manual completion only when explicitly requested', () => {
    expect(shouldCompleteMaterial({
      rule: 'manual',
      manualRequested: true,
      viewed: false,
      mediaPercent: 0,
      threshold: 90,
      quizPassed: false,
      assignmentSubmitted: false,
      scormCompleted: false,
    })).toBe(true)
  })

  it('supports view completion', () => {
    expect(shouldCompleteMaterial({
      rule: 'view',
      manualRequested: false,
      viewed: true,
      mediaPercent: 0,
      threshold: 90,
      quizPassed: false,
      assignmentSubmitted: false,
      scormCompleted: false,
    })).toBe(true)
  })

  it('completes media at configured threshold', () => {
    expect(shouldCompleteMaterial({
      rule: 'media_percentage',
      manualRequested: false,
      viewed: true,
      mediaPercent: 90,
      threshold: 90,
      quizPassed: false,
      assignmentSubmitted: false,
      scormCompleted: false,
    })).toBe(true)
  })

  it('requires a passed quiz for quiz completion', () => {
    expect(shouldCompleteMaterial({
      rule: 'quiz_pass',
      manualRequested: false,
      viewed: true,
      mediaPercent: 100,
      threshold: 90,
      quizPassed: false,
      assignmentSubmitted: false,
      scormCompleted: false,
    })).toBe(false)
  })

  it('completes assignment on valid submission', () => {
    expect(shouldCompleteMaterial({
      rule: 'assignment_submit',
      manualRequested: false,
      viewed: true,
      mediaPercent: 0,
      threshold: 90,
      quizPassed: false,
      assignmentSubmitted: true,
      scormCompleted: false,
    })).toBe(true)
  })

  it('completes SCORM only when package reports completion', () => {
    expect(shouldCompleteMaterial({
      rule: 'scorm_completion',
      manualRequested: false,
      viewed: true,
      mediaPercent: 0,
      threshold: 90,
      quizPassed: false,
      assignmentSubmitted: false,
      scormCompleted: true,
    })).toBe(true)
  })
})

describe('normalizeAttemptLimit', () => {
  it('uses null for unlimited attempts', () => {
    expect(normalizeAttemptLimit(null)).toBeNull()
  })

  it('accepts positive integer limits', () => {
    expect(normalizeAttemptLimit(3)).toBe(3)
  })

  it('rejects zero and negative limits', () => {
    expect(() => normalizeAttemptLimit(0)).toThrow('learning_attempt_limit_invalid')
    expect(() => normalizeAttemptLimit(-1)).toThrow('learning_attempt_limit_invalid')
  })
})
