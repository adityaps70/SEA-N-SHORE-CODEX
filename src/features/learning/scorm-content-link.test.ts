// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  SCORM_CONTENT_LINK_TTL_SECONDS,
  SCORM_CONTENT_SANDBOX,
  createScormContentToken,
  isScormContentToken,
  verifyScormContentToken,
} from './scorm-content-link'

const environment = { REALTIME_TICKET_SECRET: 'x'.repeat(48) }
const learner = '0b3c6f6e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'
const lesson = '7d1f2a3b-4c5d-4e6f-9a8b-1c2d3e4f5a6b'
const now = Date.UTC(2026, 9, 4, 10, 0, 0)

describe('SCORM content links (Round 14, 2.3)', () => {
  it('signs a learner and lesson into one path segment that verifies back to the learner', () => {
    const token = createScormContentToken(learner, lesson, { now, environment })
    expect(token).toMatch(/^t\.[A-Za-z0-9-]+\.\d{10}\.[A-Za-z0-9_-]{43}$/)
    expect(isScormContentToken(token!)).toBe(true)
    expect(verifyScormContentToken(token!, lesson, { now, environment })).toEqual({ ok: true, learnerId: learner })
  })

  it('refuses another lesson, a tampered learner, an expired link and an unknown secret', () => {
    const token = createScormContentToken(learner, lesson, { now, environment })!
    expect(verifyScormContentToken(token, '00000000-0000-4000-8000-000000000000', { now, environment })).toEqual({ ok: false, reason: 'bad_signature' })
    const otherLearner = token.replace(learner, '11111111-2222-4333-8444-555555555555')
    expect(verifyScormContentToken(otherLearner, lesson, { now, environment })).toEqual({ ok: false, reason: 'bad_signature' })
    const later = now + (SCORM_CONTENT_LINK_TTL_SECONDS + 1) * 1000
    expect(verifyScormContentToken(token, lesson, { now: later, environment })).toEqual({ ok: false, reason: 'expired' })
    expect(verifyScormContentToken(token, lesson, { now, environment: { REALTIME_TICKET_SECRET: 'y'.repeat(48) } })).toEqual({ ok: false, reason: 'bad_signature' })
    expect(verifyScormContentToken(token, lesson, { now, environment: {} })).toEqual({ ok: false, reason: 'not_configured' })
  })

  it('refuses a link that claims to live longer than the TTL', () => {
    const token = createScormContentToken(learner, lesson, { now: now + 60 * 60 * 1000, environment })!
    expect(verifyScormContentToken(token, lesson, { now, environment })).toEqual({ ok: false, reason: 'expired' })
  })

  it('issues nothing without a signing secret, and only recognises its own segment shape', () => {
    expect(createScormContentToken(learner, lesson, { now, environment: {} })).toBeNull()
    expect(isScormContentToken('index.html')).toBe(false)
    expect(isScormContentToken('t.short.1.x')).toBe(false)
    expect(isScormContentToken(undefined)).toBe(false)
  })

  it('sandboxes package responses without allow-same-origin', () => {
    expect(SCORM_CONTENT_SANDBOX).toMatch(/^sandbox allow-scripts/)
    expect(SCORM_CONTENT_SANDBOX).not.toContain('allow-same-origin')
    expect(SCORM_CONTENT_SANDBOX).toContain("frame-ancestors 'self'")
  })
})
