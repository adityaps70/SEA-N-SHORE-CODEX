import { describe, expect, it } from 'vitest'
import { batchClosedReason, batchInputSchema, batchStartLabel, dripAnchorDate, nextBatchStatus, seatsLeft } from './batch-rules'

const batch = { seatLimit: 10, enrolledCount: 7, heldCount: 1, status: 'upcoming' as const, enrolmentOpen: true }

describe('batch rules (round D, D1)', () => {
  it('counts seats left from enrolments and checkouts awaiting payment, never below zero', () => {
    expect(seatsLeft(batch)).toBe(2)
    expect(seatsLeft({ ...batch, enrolledCount: 12 })).toBe(0)
    expect(seatsLeft({ ...batch, seatLimit: null })).toBeNull()
  })

  it('says why a batch cannot take a learner', () => {
    expect(batchClosedReason(batch)).toBeNull()
    expect(batchClosedReason({ ...batch, enrolledCount: 9 })).toBe('full')
    expect(batchClosedReason({ ...batch, enrolmentOpen: false })).toBe('enrolment_closed')
    expect(batchClosedReason({ ...batch, status: 'completed' })).toBe('completed')
    expect(batchClosedReason({ ...batch, status: 'archived' })).toBe('archived')
    expect(batchClosedReason({ ...batch, status: 'running', seatLimit: null })).toBeNull()
  })

  it('moves a batch along by its dates and never backwards', () => {
    const now = new Date('2026-11-10T00:00:00Z')
    expect(nextBatchStatus({ status: 'upcoming', startsAt: '2026-11-09T00:00:00Z', endsAt: null }, now)).toBe('running')
    expect(nextBatchStatus({ status: 'upcoming', startsAt: '2026-11-11T00:00:00Z', endsAt: null }, now)).toBeNull()
    expect(nextBatchStatus({ status: 'running', startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-09T00:00:00Z' }, now)).toBe('completed')
    expect(nextBatchStatus({ status: 'upcoming', startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-09T00:00:00Z' }, now)).toBe('completed')
    expect(nextBatchStatus({ status: 'running', startsAt: '2026-11-01T00:00:00Z', endsAt: null, lastSessionEndsAt: '2026-11-08T12:00:00Z' }, now)).toBe('completed')
    expect(nextBatchStatus({ status: 'running', startsAt: '2026-11-01T00:00:00Z', endsAt: null, lastSessionEndsAt: '2026-11-09T12:00:00Z' }, now)).toBeNull()
    expect(nextBatchStatus({ status: 'archived', startsAt: '2026-11-01T00:00:00Z', endsAt: null }, now)).toBeNull()
  })

  it('counts drip from the batch start only when the course says so and the learner has a batch', () => {
    const enrolledAt = new Date('2026-11-05T00:00:00Z')
    const batchStartsAt = new Date('2026-11-01T00:00:00Z')
    expect(dripAnchorDate({ dripAnchor: 'batch_start', enrolledAt, batchStartsAt })).toBe(batchStartsAt)
    expect(dripAnchorDate({ dripAnchor: 'batch_start', enrolledAt, batchStartsAt: null })).toBe(enrolledAt)
    expect(dripAnchorDate({ dripAnchor: 'enrolment', enrolledAt, batchStartsAt })).toBe(enrolledAt)
  })

  it('validates batch details with plain messages', () => {
    const valid = { title: 'November batch', startsAt: '2026-11-02T13:30:00Z', endsAt: null, seatLimit: 20, timeZone: 'Asia/Kolkata', enrolmentOpen: true, status: 'upcoming' }
    expect(batchInputSchema.safeParse(valid).success).toBe(true)
    expect(batchInputSchema.safeParse({ ...valid, endsAt: '2026-11-01T00:00:00Z' }).error?.issues[0]?.message).toBe('The end date must be after the start.')
    expect(batchInputSchema.safeParse({ ...valid, timeZone: 'Mars/Olympus' }).error?.issues[0]?.message).toBe('Choose a time zone from the list.')
    expect(batchInputSchema.safeParse({ ...valid, seatLimit: 0 }).error?.issues[0]?.message).toBe('The seat limit must be at least 1.')
  })

  it('shows the start in the batch time zone with the zone named', () => {
    expect(batchStartLabel({ startsAt: '2026-11-02T13:30:00Z', timeZone: 'Asia/Kolkata' })).toBe('Starts Mon 2 Nov 2026 · Asia/Kolkata')
    expect(batchStartLabel({ startsAt: '2026-11-02T01:30:00Z', timeZone: 'America/New_York' })).toBe('Starts Sun 1 Nov 2026 · America/New_York')
  })
})
