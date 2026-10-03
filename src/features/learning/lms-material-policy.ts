export type MaterialReleaseMode = 'immediate' | 'scheduled' | 'drip'
export type MaterialLockReason = 'unpublished' | 'scheduled' | 'drip' | 'prerequisite' | null
export type MaterialCompletionRule =
  | 'manual'
  | 'view'
  | 'media_percentage'
  | 'quiz_pass'
  | 'assignment_submit'
  | 'scorm_completion'

export type MaterialAvailabilityInput = {
  isPublished: boolean
  releaseMode: MaterialReleaseMode
  releaseAt: Date | null
  dripDelayDays: number | null
  enrolledAt: Date
  now: Date
  prerequisiteRequired: boolean
  prerequisiteCompleted: boolean
}

export type MaterialCompletionInput = {
  rule: MaterialCompletionRule
  manualRequested: boolean
  viewed: boolean
  mediaPercent: number
  threshold: number
  quizPassed: boolean
  assignmentSubmitted: boolean
  scormCompleted: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

export function evaluateMaterialAvailability(input: MaterialAvailabilityInput): {
  available: boolean
  reason: MaterialLockReason
} {
  if (!input.isPublished) return { available: false, reason: 'unpublished' }

  if (input.releaseMode === 'scheduled') {
    if (!input.releaseAt || input.now.getTime() < input.releaseAt.getTime()) {
      return { available: false, reason: 'scheduled' }
    }
  }

  if (input.releaseMode === 'drip') {
    const delayDays = Math.max(0, input.dripDelayDays ?? 0)
    const releaseTime = input.enrolledAt.getTime() + delayDays * DAY_MS
    if (input.now.getTime() < releaseTime) return { available: false, reason: 'drip' }
  }

  if (input.prerequisiteRequired && !input.prerequisiteCompleted) {
    return { available: false, reason: 'prerequisite' }
  }

  return { available: true, reason: null }
}

export function shouldCompleteMaterial(input: MaterialCompletionInput) {
  switch (input.rule) {
    case 'manual':
      return input.manualRequested
    case 'view':
      return input.viewed
    case 'media_percentage':
      return input.mediaPercent >= input.threshold
    case 'quiz_pass':
      return input.quizPassed
    case 'assignment_submit':
      return input.assignmentSubmitted
    case 'scorm_completion':
      return input.scormCompleted
  }
}

export function normalizeAttemptLimit(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (!Number.isInteger(value) || value <= 0) throw new Error('learning_attempt_limit_invalid')
  return value
}

export function defaultCompletionRuleForMaterialType(materialType: string): MaterialCompletionRule {
  switch (materialType) {
    case 'video':
    case 'audio':
      return 'media_percentage'
    case 'quiz':
      return 'quiz_pass'
    case 'assignment':
      return 'assignment_submit'
    case 'scorm':
      return 'scorm_completion'
    default:
      return 'manual'
  }
}
