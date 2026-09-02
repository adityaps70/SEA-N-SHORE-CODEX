import { describe, expect, it } from 'vitest'
import { createPostInputSchema, feedRequestSchema, parseFeedCategory } from './schemas'

describe('createPostInputSchema', () => {
  it('normalizes a standard maritime post', () => {
    const parsed = createPostInputSchema.parse({
      category: 'technical_discussion',
      body: '  Main engine troubleshooting lesson.  ',
      mode: 'standard',
      pollOptions: [],
    })
    expect(parsed.body).toBe('Main engine troubleshooting lesson.')
  })

  it('rejects a poll with fewer than two distinct options', () => {
    expect(() => createPostInputSchema.parse({
      category: 'career_advice',
      body: 'Which shore role would you choose?',
      mode: 'poll',
      pollOptions: ['Marine Superintendent', 'Marine Superintendent'],
    })).toThrow()
  })

  it('normalizes poll options case-insensitively', () => {
    const parsed = createPostInputSchema.parse({
      category: 'career_advice',
      body: 'Which path?',
      mode: 'poll',
      pollOptions: ['  Marine Superintendent ', 'Vetting', 'vetting'],
    })
    expect(parsed.pollOptions).toEqual(['Marine Superintendent', 'Vetting'])
  })
})

describe('feedRequestSchema', () => {
  it('defaults to twelve posts', () => {
    expect(feedRequestSchema.parse({}).limit).toBe(12)
  })

  it('rejects a page larger than twenty posts', () => {
    expect(() => feedRequestSchema.parse({ limit: 21 })).toThrow()
  })
})

describe('parseFeedCategory', () => {
  it('returns only canonical categories', () => {
    expect(parseFeedCategory('safety_lessons')).toBe('safety_lessons')
    expect(parseFeedCategory('all')).toBeUndefined()
  })
})
