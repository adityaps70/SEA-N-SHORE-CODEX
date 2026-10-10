import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'

/**
 * Learning round D (D1 batches) against the real schema (PGlite): batch settings and batches for the course team,
 * batch staff access, enrolling and buying into a batch with its seat limit, trainer enrolment and invitations into a
 * batch, drip from the batch start, the roster filter and the status sweep. Self-paced courses stay as they are.
 * Fixture names and addresses are placeholders.
 */

let db: TestDatabase

vi.mock('@/lib/db/client', () => ({
  query: (text: string, values?: readonly unknown[]) => db.query(text, values),
  withTransaction: <T,>(work: (client: { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: QueryResultRow[] }> }) => Promise<T>) =>
    db.transaction((query) => work({ query: async (text, values) => ({ rows: await query(text, values) }) })),
}))

const { batchRepository, BatchError } = await import('./batches/batch-repository')
const { enrollmentRepository } = await import('./enrollment-repository')
const { coursePaymentRepository } = await import('./course-payment-repository')
const { courseRosterRepository, courseInvitationClaims } = await import('./course-roster-repository')
const { rosterToCsv } = await import('./course-roster')
const { dripAnchorSql } = await import('./course-access')
const fixtures = await import('./learning-test-fixtures')

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

let sequence = 0
async function member(label: string) {
  sequence += 1
  const profileId = await fixtures.createProfile(db.query, label)
  const email = `fixture-batch-member-${sequence}@example.test`
  await db.query(
    `insert into public.identity_accounts (profile_id, provider, provider_subject, email, email_verified) values ($1, 'cognito', $2, $3, true)`,
    [profileId, `fixture-batch-sub-${sequence}`, email],
  )
  return { profileId, email }
}

function code(promise: Promise<unknown>) {
  return promise.then(() => 'ok', (error: unknown) => (error instanceof BatchError ? error.code : error instanceof Error ? error.message : String(error)))
}

const DAY = 24 * 60 * 60 * 1000

function batchInput(overrides: Partial<Parameters<typeof batchRepository.create>[2]> = {}) {
  return {
    title: 'Fixture November batch',
    startsAt: new Date(Date.now() + 7 * DAY).toISOString(),
    endsAt: null,
    seatLimit: null,
    timeZone: 'Asia/Kolkata',
    enrolmentOpen: true,
    status: 'upcoming' as const,
    ...overrides,
  }
}

async function batchCourse(options: { priceMinor?: number } = {}) {
  const mentor = await fixtures.createActiveMentor(db.query)
  const course = await fixtures.createPublishedCourse(db.query, mentor, options)
  await batchRepository.saveSettings({ actorId: mentor.userId }, course.courseId, { batchMode: 'batches', dripAnchor: 'batch_start', minAttendancePercent: null })
  return { mentor, course }
}

function pgClient(query: (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>) {
  return {
    async query<T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) {
      return { rows: await query(text, values) as T[] }
    },
  }
}

describe('batches for the course team (D1)', () => {
  it('saves the settings and batches, audited; strangers and batch staff cannot change them', async () => {
    const { mentor, course } = await batchCourse()
    const batchId = await batchRepository.create({ actorId: mentor.userId }, course.courseId, batchInput({ seatLimit: 12 }))
    const listed = await batchRepository.listForCourse({ actorId: mentor.userId }, course.courseId)
    expect(listed.course.settings).toEqual({ batchMode: 'batches', dripAnchor: 'batch_start', minAttendancePercent: null })
    expect(listed.batches).toEqual([expect.objectContaining({ id: batchId, title: 'Fixture November batch', seatLimit: 12, status: 'upcoming', enrolledCount: 0 })])

    const stranger = await fixtures.createActiveMentor(db.query)
    expect(await code(batchRepository.listForCourse({ actorId: stranger.userId }, course.courseId))).toBe('course_not_found')
    expect(await code(batchRepository.getForStaff({ actorId: stranger.userId }, batchId))).toBe('batch_not_found')

    const instructor = await member('Fixture Instructor')
    expect(await batchRepository.addInstructor({ actorId: mentor.userId }, batchId, instructor.email)).toBe(true)
    const staffView = await batchRepository.getForStaff({ actorId: instructor.profileId }, batchId)
    expect(staffView.canManageCourse).toBe(false)
    expect(staffView.instructors).toEqual([{ profileId: instructor.profileId, name: 'Fixture Instructor' }])
    expect(await code(batchRepository.update({ actorId: instructor.profileId }, batchId, batchInput({ title: 'Renamed' })))).toBe('batch_not_found')
    expect(await code(batchRepository.listForCourse({ actorId: instructor.profileId }, course.courseId))).toBe('course_not_found')
    expect((await batchRepository.listTeaching(instructor.profileId)).map((row) => [row.batch.id, row.role])).toEqual([[batchId, 'instructor']])

    const manager = await member('Fixture Batch Manager')
    await batchRepository.setManager({ actorId: mentor.userId }, batchId, manager.email)
    expect((await batchRepository.getForStaff({ actorId: manager.profileId }, batchId)).batch.managerName).toBe('Fixture Batch Manager')
    expect(await code(batchRepository.setManager({ actorId: mentor.userId }, batchId, 'nobody@example.test'))).toBe('member_not_found')

    const actions = await db.query(
      `select action, metadata from public.audit_events where target_id = $1 and action like 'learning.batch%' order by created_at, action`,
      [course.courseId],
    )
    expect(actions.map((row) => row.action)).toEqual(expect.arrayContaining([
      'learning.batch_settings_saved', 'learning.batch_created', 'learning.batch_instructor_added', 'learning.batch_manager_set',
    ]))
    expect(JSON.stringify(actions)).not.toContain('@example.test')
  })
})

describe('joining a batch (D1)', () => {
  it('enrols a free learner into the chosen batch and stops at the seat limit', async () => {
    const { mentor, course } = await batchCourse()
    const batchId = await batchRepository.create({ actorId: mentor.userId }, course.courseId, batchInput({ seatLimit: 1 }))
    const first = await fixtures.createProfile(db.query, 'Fixture Learner One')
    const second = await fixtures.createProfile(db.query, 'Fixture Learner Two')

    expect(await code(enrollmentRepository.enrollFreeCourse(first, course.courseId, null))).toBe('batch_required')
    const results = await Promise.all([
      code(enrollmentRepository.enrollFreeCourse(first, course.courseId, batchId)),
      code(enrollmentRepository.enrollFreeCourse(second, course.courseId, batchId)),
    ])
    expect(results.sort()).toEqual(['full', 'ok'])
    expect(await db.query(`select count(*)::int as count from public.learning_enrollments where batch_id = $1`, [batchId])).toEqual([{ count: 1 }])
  })

  it('keeps a self-paced course exactly as before: no batch needed, any batch id ignored', async () => {
    const mentor = await fixtures.createActiveMentor(db.query)
    const course = await fixtures.createPublishedCourse(db.query, mentor)
    const learner = await fixtures.createProfile(db.query, 'Fixture Self-paced Learner')
    const result = await enrollmentRepository.enrollFreeCourse(learner, course.courseId)
    expect(result.alreadyEnrolled).toBe(false)
    expect(await db.query(`select batch_id from public.learning_enrollments where id = $1`, [result.enrollmentId])).toEqual([{ batch_id: null }])
    expect((await batchRepository.listForCourse({ actorId: mentor.userId }, course.courseId)).course.settings.batchMode).toBe('self_paced')
  })

  it('holds a seat for a checkout and puts the paid enrolment in the batch', async () => {
    const { mentor, course } = await batchCourse({ priceMinor: 100_000 })
    const batchId = await batchRepository.create({ actorId: mentor.userId }, course.courseId, batchInput({ seatLimit: 1 }))
    const buyer = await fixtures.createProfile(db.query, 'Fixture Buyer')
    const other = await fixtures.createProfile(db.query, 'Fixture Other Buyer')
    const start = (profileId: string, chosen: string | null) => coursePaymentRepository.prepareCheckoutOrder({
      profileId, courseId: course.courseId, provider: 'cashfree', currencies: ['INR'], billing: { stateCode: '27' }, batchId: chosen,
    })

    expect(await code(start(buyer, null))).toBe('batch_required')
    const { order } = await start(buyer, batchId)
    expect(await db.query(`select batch_id from public.course_payment_orders where id = $1`, [order.id])).toEqual([{ batch_id: batchId }])
    expect(await code(start(other, batchId))).toBe('full')
    // Starting again with other details replaces the buyer's checkout and does not count their own seat twice.
    await coursePaymentRepository.attachProviderOrder(order.id, 'crs_fixture_batch_order')
    expect(await code(coursePaymentRepository.prepareCheckoutOrder({
      profileId: buyer, courseId: course.courseId, provider: 'cashfree', currencies: ['INR'], billing: { stateCode: '29' }, batchId,
    }))).toBe('ok')

    const latest = (await db.query(`select id from public.course_payment_orders where profile_id = $1 and status = 'created'`, [buyer]))[0]!.id as string
    const outcome = await db.transaction((query) => coursePaymentRepository.confirmPaidOrder(pgClient(query), {
      orderId: latest, providerPaymentId: 'pay_fixture_batch', amountMinor: 100_000, currency: 'INR',
    }))
    expect(outcome.state).toBe('enrolled')
    expect(await db.query(`select batch_id, enrollment_source from public.learning_enrollments where learner_id = $1`, [buyer]))
      .toEqual([{ batch_id: batchId, enrollment_source: 'purchase' }])
  })

  it('lets the trainer add a member or invite someone into a batch, and moves a learner between batches', async () => {
    const { mentor, course } = await batchCourse()
    const morning = await batchRepository.create({ actorId: mentor.userId }, course.courseId, batchInput({ title: 'Fixture Morning batch' }))
    const evening = await batchRepository.create({ actorId: mentor.userId }, course.courseId, batchInput({ title: 'Fixture Evening batch' }))
    const learner = await member('Fixture Trainee')

    expect(await code(courseRosterRepository.enrolByEmail({ actorId: mentor.userId, courseId: course.courseId }, learner.email))).toBe('batch_required')
    await courseRosterRepository.enrolByEmail({ actorId: mentor.userId, courseId: course.courseId, batchId: morning }, learner.email)
    const enrollment = (await db.query(`select id, batch_id from public.learning_enrollments where learner_id = $1`, [learner.profileId]))[0]!
    expect(enrollment.batch_id).toBe(morning)

    const invitee = 'fixture-batch-invitee@example.test'
    expect(await courseRosterRepository.enrolByEmail({ actorId: mentor.userId, courseId: course.courseId, batchId: evening }, invitee)).toEqual({ kind: 'invited' })
    const inviteeProfile = await fixtures.createProfile(db.query, 'Fixture Invitee')
    await db.query(
      `insert into public.identity_accounts (profile_id, provider, provider_subject, email, email_verified) values ($1, 'cognito', 'fixture-batch-invitee', $2, true)`,
      [inviteeProfile, invitee],
    )
    expect(await courseInvitationClaims.forProfile(inviteeProfile)).toBe(1)
    expect(await db.query(`select batch_id from public.learning_enrollments where learner_id = $1`, [inviteeProfile])).toEqual([{ batch_id: evening }])

    expect(await batchRepository.moveLearner({ actorId: mentor.userId }, { courseId: course.courseId, enrollmentId: String(enrollment.id), toBatchId: evening })).toBe(true)
    expect(await db.query(`select batch_id from public.learning_enrollments where id = $1`, [enrollment.id])).toEqual([{ batch_id: evening }])
  })
})

describe('drip, roster and status (D1)', () => {
  it('counts drip lessons from the batch start when the course says so', async () => {
    const { mentor, course } = await batchCourse()
    const startsAt = new Date(Date.now() - 5 * DAY)
    const batchId = await batchRepository.create({ actorId: mentor.userId }, course.courseId, batchInput({ startsAt: startsAt.toISOString(), status: 'running' }))
    const learner = await fixtures.createProfile(db.query, 'Fixture Late Joiner')
    const { enrollmentId } = await enrollmentRepository.enrollFreeCourse(learner, course.courseId, batchId)
    const anchor = async () => (await db.query(`select ${dripAnchorSql()} as anchor from public.learning_enrollments enrollment where enrollment.id = $1`, [enrollmentId]))[0]!.anchor
    expect(Math.abs(new Date(String(await anchor())).getTime() - startsAt.getTime())).toBeLessThan(1000)

    await batchRepository.saveSettings({ actorId: mentor.userId }, course.courseId, { batchMode: 'batches', dripAnchor: 'enrolment', minAttendancePercent: null })
    expect(Math.abs(new Date(String(await anchor())).getTime() - Date.now())).toBeLessThan(60_000)
  })

  it('filters the roster by batch, lets batch staff read only their batch, and adds the Batch column to the CSV', async () => {
    const { mentor, course } = await batchCourse()
    const alpha = await batchRepository.create({ actorId: mentor.userId }, course.courseId, batchInput({ title: 'Fixture Alpha' }))
    const beta = await batchRepository.create({ actorId: mentor.userId }, course.courseId, batchInput({ title: 'Fixture Beta' }))
    await enrollmentRepository.enrollFreeCourse(await fixtures.createProfile(db.query, 'Fixture Alpha Learner'), course.courseId, alpha)
    await enrollmentRepository.enrollFreeCourse(await fixtures.createProfile(db.query, 'Fixture Beta Learner'), course.courseId, beta)

    const all = await courseRosterRepository.list({ actorId: mentor.userId, courseId: course.courseId })
    expect(all.learners.map((learner) => learner.batchTitle).sort()).toEqual(['Fixture Alpha', 'Fixture Beta'])
    const onlyAlpha = await courseRosterRepository.list({ actorId: mentor.userId, courseId: course.courseId, batchId: alpha })
    expect(onlyAlpha.learners.map((learner) => learner.name)).toEqual(['Fixture Alpha Learner'])

    const instructor = await member('Fixture Alpha Instructor')
    await batchRepository.addInstructor({ actorId: mentor.userId }, alpha, instructor.email)
    const staffView = await courseRosterRepository.list({ actorId: instructor.profileId, courseId: course.courseId, batchId: alpha })
    expect(staffView.course.canManage).toBe(false)
    expect(staffView.learners.map((learner) => learner.name)).toEqual(['Fixture Alpha Learner'])
    expect(await code(courseRosterRepository.list({ actorId: instructor.profileId, courseId: course.courseId, batchId: beta }))).toBe('course_not_found')
    expect(await code(courseRosterRepository.list({ actorId: instructor.profileId, courseId: course.courseId }))).toBe('course_not_found')
    expect(await code(courseRosterRepository.enrolByEmail({ actorId: instructor.profileId, courseId: course.courseId, batchId: alpha }, 'someone@example.test'))).toBe('course_not_found')

    const exported = await courseRosterRepository.exportRoster({ actorId: instructor.profileId, courseId: course.courseId, batchId: alpha })
    const csv = rosterToCsv(exported.learners, { includeBatch: exported.course.batchMode === 'batches' })
    expect(csv.split('\r\n')[0]).toBe('﻿Name,Rank,Batch,Enrolled,How,Status,Progress %,Lessons completed,Last active,Quiz best scores,Certificate,Access until')
    expect(csv).toContain('Fixture Alpha Learner')
    expect(csv).not.toContain('Fixture Beta Learner')
  })

  it('moves batches from upcoming to running to completed, and leaves archived ones alone', async () => {
    const { mentor, course } = await batchCourse()
    const started = await batchRepository.create({ actorId: mentor.userId }, course.courseId, batchInput({ startsAt: new Date(Date.now() - DAY).toISOString() }))
    const ended = await batchRepository.create({ actorId: mentor.userId }, course.courseId, batchInput({
      startsAt: new Date(Date.now() - 10 * DAY).toISOString(), endsAt: new Date(Date.now() - DAY).toISOString(), status: 'running',
    }))
    const archived = await batchRepository.create({ actorId: mentor.userId }, course.courseId, batchInput({ startsAt: new Date(Date.now() - DAY).toISOString(), status: 'archived' }))
    await batchRepository.advanceStatuses()
    const statuses = await db.query(`select id, status from public.learning_course_batches where id = any($1::uuid[])`, [[started, ended, archived]])
    expect(Object.fromEntries(statuses.map((row) => [row.id, row.status]))).toEqual({ [started]: 'running', [ended]: 'completed', [archived]: 'archived' })
  })
})
