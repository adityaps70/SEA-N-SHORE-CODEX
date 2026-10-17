import { describe, expect, it } from 'vitest'
import { formatYears, pluralize, pluralizeWithVerb } from './format'

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

  it('uses the plural for zero, negatives and fractions (round H, H7)', () => {
    expect(pluralize(0, 'comment')).toBe('0 comments')
    expect(pluralize(-1, 'day')).toBe('-1 days')
    expect(pluralize(1.5, 'hour')).toBe('1.5 hours')
    expect(pluralize(1, 'more comment', 'more comments')).toBe('1 more comment')
    expect(pluralize(1, 'unread message')).toBe('1 unread message')
    expect(pluralize(2, 'entry', 'entries')).toBe('2 entries')
  })
})

describe('pluralizeWithVerb (round H, H7)', () => {
  it('makes the verb agree with the count', () => {
    expect(pluralizeWithVerb(1, 'item', 'needs attention', 'need attention')).toBe('1 item needs attention')
    expect(pluralizeWithVerb(4, 'item', 'needs attention', 'need attention')).toBe('4 items need attention')
    expect(pluralizeWithVerb(0, 'person', 'follows', 'follow', 'people')).toBe('0 people follow')
  })
})
