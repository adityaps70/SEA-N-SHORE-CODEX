import { describe, expect, it } from 'vitest'
import { formatCourseDuration } from './course-duration'

describe('formatCourseDuration (Round H, H7)', () => {
  it('formats hours and minutes', () => {
    expect(formatCourseDuration(6 * 3600 + 30 * 60)).toBe('6 h 30 min')
    expect(formatCourseDuration(2 * 3600)).toBe('2 h')
    expect(formatCourseDuration(45 * 60)).toBe('45 min')
    expect(formatCourseDuration(3600 + 60)).toBe('1 h 1 min')
  })

  it('rounds to the nearest minute, with at least 1 min', () => {
    expect(formatCourseDuration(89)).toBe('1 min')
    expect(formatCourseDuration(90)).toBe('2 min')
    expect(formatCourseDuration(20)).toBe('1 min')
    expect(formatCourseDuration(3599)).toBe('1 h')
  })

  it('is null when there is no duration', () => {
    expect(formatCourseDuration(0)).toBeNull()
    expect(formatCourseDuration(-5)).toBeNull()
    expect(formatCourseDuration(null)).toBeNull()
    expect(formatCourseDuration(Number.NaN)).toBeNull()
  })
})
