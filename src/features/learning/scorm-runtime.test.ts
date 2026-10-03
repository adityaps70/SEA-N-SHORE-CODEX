import { describe, expect, it } from 'vitest'
import {
  createScormRuntimeState,
  isScormCompletionTerminal,
  normalizeScorm12Update,
  normalizeScorm2004Update,
  parseScormTimeToSeconds,
} from './scorm-runtime'

describe('SCORM runtime normalization', () => {
  it('normalizes SCORM 1.2 lesson status and score', () => {
    const next = normalizeScorm12Update(createScormRuntimeState(), {
      'cmi.core.lesson_status': 'passed',
      'cmi.core.score.raw': '86',
      'cmi.core.lesson_location': 'module-3',
      'cmi.suspend_data': 'bookmark=3',
      'cmi.core.session_time': '00:12:30',
    })
    expect(next.completionStatus).toBe('passed')
    expect(next.successStatus).toBe('passed')
    expect(next.scoreRaw).toBe(86)
    expect(next.location).toBe('module-3')
    expect(next.suspendData).toBe('bookmark=3')
    expect(next.sessionTimeSeconds).toBe(750)
    expect(isScormCompletionTerminal(next)).toBe(true)
  })

  it('normalizes SCORM 2004 completion and scaled score', () => {
    const next = normalizeScorm2004Update(createScormRuntimeState(), {
      'cmi.completion_status': 'completed',
      'cmi.success_status': 'passed',
      'cmi.score.scaled': '0.82',
      'cmi.location': 'sco-8',
      'cmi.suspend_data': 'resume-me',
      'cmi.session_time': 'PT8M20S',
    })
    expect(next.completionStatus).toBe('completed')
    expect(next.successStatus).toBe('passed')
    expect(next.scoreScaled).toBe(0.82)
    expect(next.sessionTimeSeconds).toBe(500)
    expect(isScormCompletionTerminal(next)).toBe(true)
  })

  it('keeps incomplete packages incomplete', () => {
    const next = normalizeScorm2004Update(createScormRuntimeState(), {
      'cmi.completion_status': 'incomplete',
      'cmi.success_status': 'unknown',
    })
    expect(isScormCompletionTerminal(next)).toBe(false)
  })

  it('parses SCORM 1.2 and ISO 8601 durations', () => {
    expect(parseScormTimeToSeconds('01:02:03.5')).toBe(3723)
    expect(parseScormTimeToSeconds('PT1H2M3S')).toBe(3723)
  })
})
