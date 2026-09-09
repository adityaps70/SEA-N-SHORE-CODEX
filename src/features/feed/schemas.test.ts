import { describe, expect, it } from 'vitest'
import {
  createPostInputSchema,
  feedRequestSchema,
  parseFeedCategory,
  postMediaReferenceSchema,
} from './schemas'

const mediaReference = {
  postId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  storagePath: '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc.mp4',
  mimeType: 'video/mp4',
  size: 1024,
  altText: '  Engine room walkthrough  ',
} as const

describe('postMediaReferenceSchema', () => {
  it('normalizes a complete approved direct-upload reference', () => {
    expect(postMediaReferenceSchema.parse(mediaReference)).toEqual({
      ...mediaReference,
      altText: 'Engine room walkthrough',
    })
  })

  it.each([
    { ...mediaReference, postId: undefined },
    { ...mediaReference, storagePath: undefined },
    { ...mediaReference, mimeType: undefined },
    { ...mediaReference, size: undefined },
  ])('rejects a partial media reference', (input) => {
    expect(() => postMediaReferenceSchema.parse(input)).toThrow()
  })

  it('rejects unsupported media and invalid metadata', () => {
    expect(() => postMediaReferenceSchema.parse({ ...mediaReference, mimeType: 'video/quicktime' })).toThrow()
    expect(() => postMediaReferenceSchema.parse({ ...mediaReference, size: 0 })).toThrow()
    expect(() => postMediaReferenceSchema.parse({ ...mediaReference, altText: 'a'.repeat(301) })).toThrow()
  })
})

describe('createPostInputSchema', () => {
  it('normalizes a standard maritime post without media', () => {
    const parsed = createPostInputSchema.parse({
      category: 'technical_discussion',
      body: '  Main engine troubleshooting lesson.  ',
      mode: 'standard',
      pollOptions: [],
    })
    expect(parsed.body).toBe('Main engine troubleshooting lesson.')
    expect(parsed.media).toBeUndefined()
  })

  it('accepts one completed direct-upload media reference on a standard post', () => {
    const parsed = createPostInputSchema.parse({
      category: 'technical_discussion',
      body: 'Engine room walkthrough.',
      mode: 'standard',
      media: mediaReference,
    })

    expect(parsed.media).toEqual({ ...mediaReference, altText: 'Engine room walkthrough' })
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

  it('rejects any media reference on a technical poll', () => {
    expect(() => createPostInputSchema.parse({
      category: 'technical_discussion',
      body: 'Which inspection first?',
      mode: 'poll',
      pollOptions: ['Mooring', 'Bridge'],
      media: mediaReference,
    })).toThrow(/Technical polls cannot include media/)
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
