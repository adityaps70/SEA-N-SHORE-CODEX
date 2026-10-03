import { describe, expect, it } from 'vitest'
import { formatYears, pluralize } from './format'

describe('formatYears', () => {
  it('uses the singular for exactly one year', () => {
    expect(formatYears(1)).toBe('1 year')
    expect(formatYears('1')).toBe('1 year')
  })

  it('uses the plural otherwise', () => {
    expect(formatYears(0)).toBe('0 years')
    expect(formatYears(1.5)).toBe('1.5 years')
    expect(formatYears(12)).toBe('12 years')
  })

  it('falls back when the value is missing or not a number', () => {
    expect(formatYears(null)).toBe('Not listed')
    expect(formatYears(undefined, '—')).toBe('—')
    expect(formatYears('abc')).toBe('Not listed')
  })
})

describe('pluralize', () => {
  it('handles regular and irregular plurals', () => {
    expect(pluralize(1, 'result')).toBe('1 result')
    expect(pluralize(3, 'result')).toBe('3 results')
    expect(pluralize(2, 'person', 'people')).toBe('2 people')
  })
})
