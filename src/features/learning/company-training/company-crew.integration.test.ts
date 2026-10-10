import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'

/**
 * D3 company training crew, seats and dashboard against the real schema (PGlite): invitations answered only by the
 * member they were sent to, consent recorded append-only, seats only for active crew with the pack's plan access,
 * reassignment at 10 % progress or less, and a dashboard that shows only assigned-course progress and certificates of
 * members who still share. Placeholder data only.
 */

let db: TestDatabase

vi.mock('@/lib/db/client', () => ({
  query: (text: string, values?: readonly unknown[]) => db.query(text, values),
  withTransaction: <T,>(work: (client: { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: QueryResultRow[] }> }) => Promise<T>) =>
    db.transaction((query) => work({ query: async (text, values) => ({ rows: await query(text, values) }) })),
}))

const { coursePaymentRepository } = await import('../course-payment-repository')
const { crewRepository } = await import('./crew-repository')
const { seatRepository } = await import('./seat-repository')
const { trainingDashboardRepository } = await import('./dashboard-repository')
const { createCompanyInvitationEmailRepository } = await import('./company-invitation-email')
const fixtures = await import('../learning-test-fixtures')

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
  const email = `fixture-crew-${sequence}@example.test`
  await db.query(
    `insert into public.identity_accounts (profile_id, provider, provider_subject, email, email_verified) values ($1, 'cognito', $2, $3, true)`,
    [profileId, `fixture-crew-sub-${sequence}`, email],
  )
  return { profileId, email }
}

async function setup(seats = 5, months: number | null = 12) {
  sequence += 1
  const admin = await fixtures.createProfile(db.query, `Fixture Training Admin ${sequence}`)
  const [company] = await db.query(
    `insert into public.companies (slug, name, created_by, is_verified) values ($1, $2, $3, true) returning id`,
    [`fixture-crew-company-${sequence}`, `Fixture Crewing ${sequence}`, admin],
  )
  const companyId = String(company!.id)
  await db.query(`insert into public.company_members (company_id, user_id, role, approved_at) values ($1, $2, 'administrator', now())`, [companyId, admin])
  const mentor = await fixtures.createActiveMentor(db.query)
  const course = await fixtures.createPublishedCourse(db.query, mentor, { priceMinor: 100_000 })
  if (months) {
    await db.query(
      `insert into public.learning_course_plans (course_id, name, price_minor, currency, access_months, position) values ($1, 'Year', 100000, 'INR', $2, 0)`,
      [course.courseId, months],
    )
  }
  const { order } = await coursePaymentRepository.prepareSeatCheckoutOrder({
    profileId: admin, companyId, courseId: course.courseId, provider: 'cashfree', quantity: seats,
    billing: { stateCode: '27', company: 'Fixture Crewing LLP', gstin: '27AASFB2030K1ZE' },
  })
  await db.transaction((query) => coursePaymentRepository.confirmPaidOrder({ query: async (text: string, values?: readonly unknown[]) => ({ rows: await query(text, values) }) } as never, {
    orderId: order.id, providerPaymentId: `pay_${order.id.slice(0, 8)}`, amountMinor: order.amountMinor, currency: order.currency,
  }))
  return { companyId, admin, course, orderId: order.id }
}

async function join(companyId: string, admin: string, person: { profileId: string; email: string }, tags: { vessel?: string; rank?: string } = {}) {
  await crewRepository.invite({ actorId: admin }, companyId, { emails: [person.email], vessel: tags.vessel ?? null, rank: tags.rank ?? null })
  const [invitation] = await db.query(`select id from public.company_training_invitations where company_id = $1 and email = $2 and status = 'pending'`, [companyId, person.email])
  await crewRepository.accept(person.profileId, String(invitation!.id))
  return String(invitation!.id)
}

describe('company training crew, seats and dashboard (D3)', () => {
  it('lets only the invited member answer, records consent append-only, and emails each invitation once', async () => {
    const { companyId, admin } = await setup(1)
    const invited = await member('Fixture Invited Member')
    const stranger = await member('Fixture Stranger')
    const outcome = await crewRepository.invite({ actorId: admin }, companyId, { emails: [invited.email, 'not-a-member-yet@example.test'], vessel: 'MT Fixture Star', rank: 'Second Officer' })
    expect(outcome).toEqual({ invited: 2, alreadyInCrew: 0, alreadyInvited: 0 })
    expect(await crewRepository.invite({ actorId: admin }, companyId, { emails: [invited.email] })).toEqual({ invited: 0, alreadyInCrew: 0, alreadyInvited: 1 })

    const [invitation] = await db.query(`select id from public.company_training_invitations where email = $1`, [invited.email])
    const invitationId = String(invitation!.id)
    await expect(crewRepository.accept(stranger.profileId, invitationId)).rejects.toMatchObject({ code: 'invitation_other_email' })
    expect(await crewRepository.invitationsForMember(invited.profileId)).toEqual([expect.objectContaining({ id: invitationId, companyId })])
    expect(await crewRepository.invitationsForMember(stranger.profileId)).toEqual([])

    await crewRepository.accept(invited.profileId, invitationId)
    const [learner] = await db.query(`select status, vessel, rank, consent_version from public.company_training_learners where company_id = $1 and profile_id = $2`, [companyId, invited.profileId])
    expect(learner).toEqual({ status: 'active', vessel: 'MT Fixture Star', rank: 'Second Officer', consent_version: 'company-training-v1' })
    await expect(crewRepository.accept(invited.profileId, invitationId)).rejects.toMatchObject({ code: 'invitation_closed' })
    expect(await crewRepository.invite({ actorId: admin }, companyId, { emails: [invited.email] })).toEqual({ invited: 0, alreadyInCrew: 1, alreadyInvited: 0 })

    await crewRepository.withdraw(invited.profileId, companyId)
    const events = await db.query(`select event, source from public.company_training_consent_events where company_id = $1 and profile_id = $2 order by created_at, event desc`, [companyId, invited.profileId])
    expect(events).toEqual([{ event: 'granted', source: 'invitation' }, { event: 'withdrawn', source: 'my_learning' }])
    await expect(db.query(`update public.company_training_consent_events set event = 'granted' where profile_id = $1`, [invited.profileId])).rejects.toThrow(/cannot be changed/)
    await expect(db.query(`delete from public.company_training_consent_events where profile_id = $1`, [invited.profileId])).rejects.toThrow(/cannot be changed/)

    // Emails: the member gets the invitation link, the newcomer the sign-up link; each is claimed once.
    const emails = createCompanyInvitationEmailRepository()
    const batch = await emails.claimBatch(10)
    const newcomer = batch.find((delivery) => delivery.email === 'not-a-member-yet@example.test')
    expect(newcomer).toMatchObject({ isMember: false, companyName: expect.stringContaining('Fixture Crewing') })
    expect((await emails.claimBatch(10)).find((delivery) => delivery.email === 'not-a-member-yet@example.test')).toBeUndefined()
  }, 120_000)

  it('gives seats only to active crew, with the pack plan access, and never twice', async () => {
    const { companyId, admin, course } = await setup(2, 12)
    const crew = await member('Fixture Crew One')
    const outsider = await member('Fixture Not Crew')
    await join(companyId, admin, crew, { vessel: 'MV Fixture One', rank: 'Chief Officer' })

    const outcomes = await seatRepository.assign({ actorId: admin }, companyId, { courseId: course.courseId, profileIds: [crew.profileId, outsider.profileId] })
    expect(outcomes).toEqual([
      expect.objectContaining({ profileId: crew.profileId, ok: true }),
      { profileId: outsider.profileId, ok: false, code: 'seat_learner_not_in_crew' },
    ])
    const [enrollment] = await db.query(
      `select enrollment_source, status, company_seat_id, access_expires_at, plan_id from public.learning_enrollments where course_id = $1 and learner_id = $2`,
      [course.courseId, crew.profileId],
    )
    expect(enrollment).toMatchObject({ enrollment_source: 'trainer', status: 'active', company_seat_id: expect.any(String), plan_id: expect.any(String) })
    const months = (Date.parse(String(enrollment!.access_expires_at)) - Date.now()) / (30.4 * 24 * 60 * 60 * 1000)
    expect(months).toBeGreaterThan(11.5)
    expect(months).toBeLessThan(12.5)
    expect(await db.query(`select count(*)::int as count from public.notifications where recipient_id = $1 and notification_type = 'learning_enrolled'`, [crew.profileId])).toEqual([{ count: 1 }])

    // Already enrolled: no second seat is used.
    expect(await seatRepository.assign({ actorId: admin }, companyId, { courseId: course.courseId, profileIds: [crew.profileId] }))
      .toEqual([{ profileId: crew.profileId, ok: false, code: 'seat_learner_already_enrolled' }])
    expect(await db.query(`select status, count(*)::int as count from public.company_training_seats where company_id = $1 group by status order by status`, [companyId]))
      .toEqual([{ status: 'assigned', count: 1 }, { status: 'available', count: 1 }])
    // An assigned seat makes the pack non-refundable as a whole.
    const recruiter = await fixtures.createProfile(db.query, 'Fixture Recruiter')
    await db.query(`insert into public.company_members (company_id, user_id, role, approved_at) values ($1, $2, 'recruiter', now())`, [companyId, recruiter])
    await expect(seatRepository.assign({ actorId: recruiter }, companyId, { courseId: course.courseId, profileIds: [crew.profileId] })).rejects.toMatchObject({ code: 'company_training_not_allowed' })
  }, 120_000)

  it('moves a seat while its learner is at 10% or less, and refuses past that or after they stopped sharing', async () => {
    const { companyId, admin, course } = await setup(3)
    const first = await member('Fixture First Learner')
    const second = await member('Fixture Second Learner')
    const third = await member('Fixture Third Learner')
    for (const person of [first, second, third]) await join(companyId, admin, person)
    const [assigned] = await seatRepository.assign({ actorId: admin }, companyId, { courseId: course.courseId, profileIds: [first.profileId] })
    if (!assigned?.ok) throw new Error('assign failed')

    await seatRepository.reassign({ actorId: admin }, companyId, { seatId: assigned.seatId, toProfileId: second.profileId })
    const [old] = await db.query(`select status, company_seat_id from public.learning_enrollments where id = $1`, [assigned.enrollmentId])
    expect(old).toEqual({ status: 'revoked', company_seat_id: null })
    const [seat] = await db.query(`select learner_id, times_assigned from public.company_training_seats where id = $1`, [assigned.seatId])
    expect(seat).toEqual({ learner_id: second.profileId, times_assigned: 2 })

    // The second learner completes 2 of the course's 6 lessons (33%): the seat stays with them.
    const [enrollment] = await db.query(`select id from public.learning_enrollments where course_id = $1 and learner_id = $2`, [course.courseId, second.profileId])
    await fixtures.completeLessons(db.query, String(enrollment!.id), [course.lessons.intro!, course.lessons.video!])
    await expect(seatRepository.reassign({ actorId: admin }, companyId, { seatId: assigned.seatId, toProfileId: third.profileId })).rejects.toMatchObject({ code: 'seat_reassign_progress_too_high' })

    const [another] = await seatRepository.assign({ actorId: admin }, companyId, { courseId: course.courseId, profileIds: [third.profileId] })
    if (!another?.ok) throw new Error('assign failed')
    await crewRepository.withdraw(third.profileId, companyId)
    await expect(seatRepository.reassign({ actorId: admin }, companyId, { seatId: another.seatId, toProfileId: first.profileId })).rejects.toMatchObject({ code: 'seat_reassign_sharing_stopped' })
  }, 120_000)

  it('shows only assigned-course progress and certificates of members who share, and audits the CSV export', async () => {
    const { companyId, admin, course } = await setup(3)
    const sharing = await member('Fixture Sharing Learner')
    const stopped = await member('Fixture Stopped Learner')
    await join(companyId, admin, sharing, { vessel: 'MT Fixture Star', rank: 'Master' })
    await join(companyId, admin, stopped, { vessel: 'MT Fixture Star', rank: 'Bosun' })
    await seatRepository.assign({ actorId: admin }, companyId, { courseId: course.courseId, profileIds: [sharing.profileId, stopped.profileId] })
    const [enrollment] = await db.query(`select id from public.learning_enrollments where course_id = $1 and learner_id = $2`, [course.courseId, sharing.profileId])
    await fixtures.completeLessons(db.query, String(enrollment!.id), [course.lessons.intro!, course.lessons.video!, course.lessons.checklist!])

    // The sharing learner also has their own course, which the company must never see.
    const otherMentor = await fixtures.createActiveMentor(db.query)
    const ownCourse = await fixtures.createPublishedCourse(db.query, otherMentor, { priceMinor: 0 })
    await db.query(`insert into public.learning_enrollments (course_id, learner_id, enrollment_source, status) values ($1, $2, 'free', 'active')`, [ownCourse.courseId, sharing.profileId])
    await crewRepository.withdraw(stopped.profileId, companyId)

    const dashboard = await trainingDashboardRepository.dashboard({ actorId: admin }, companyId)
    expect(dashboard.seats).toHaveLength(2)
    expect(dashboard.seats.every((seat) => seat.courseId === course.courseId)).toBe(true)
    const shared = dashboard.seats.find((seat) => seat.learner.profileId === sharing.profileId)!
    const hidden = dashboard.seats.find((seat) => seat.learner.profileId === stopped.profileId)!
    expect(shared).toMatchObject({ sharing: 'active', progress: { percent: 50, state: 'in_progress' }, learner: { vessel: 'MT Fixture Star', rank: 'Master' } })
    expect(hidden).toMatchObject({ sharing: 'withdrawn', progress: null, canReassign: false })
    expect(dashboard.totals).toMatchObject({ seatsBought: 3, seatsAssigned: 2, seatsAvailable: 1, crewActive: 1, crewStoppedSharing: 1, inProgress: 1 })
    expect(dashboard.byVessel).toEqual([{ label: 'MT Fixture Star', assigned: 1, notStarted: 0, inProgress: 1, completed: 0 }])
    expect(dashboard.byRank).toEqual([{ label: 'Master', assigned: 1, notStarted: 0, inProgress: 1, completed: 0 }])

    const csv = await trainingDashboardRepository.exportCsv({ actorId: admin }, companyId)
    const lines = csv.trim().split('\r\n')
    expect(lines[0]).toBe('Name,Vessel,Rank,Course,Assigned on,Sharing,Progress %,Status,Completed on,Certificate number,Certificate issued,Certificate expires,Access until')
    expect(lines).toHaveLength(3)
    expect(csv).toContain('Fixture Stopped Learner,MT Fixture Star,Bosun')
    expect(csv).toContain('Stopped sharing,,,')
    expect(csv).not.toContain(ownCourse.slug)
    const [audit] = await db.query(`select metadata from public.audit_events where action = 'company_training.exported' and target_id = $1`, [companyId])
    expect(audit!.metadata).toEqual({ rows: 2, platformAdmin: false })

    // Someone else from the company without a training role sees nothing.
    const recruiter = await fixtures.createProfile(db.query, 'Fixture Recruiter Viewer')
    await db.query(`insert into public.company_members (company_id, user_id, role, approved_at) values ($1, $2, 'recruiter', now())`, [companyId, recruiter])
    await expect(trainingDashboardRepository.dashboard({ actorId: recruiter }, companyId)).rejects.toMatchObject({ code: 'company_training_not_allowed' })
    await expect(crewRepository.list({ actorId: recruiter }, companyId)).rejects.toMatchObject({ code: 'company_training_not_allowed' })
  }, 120_000)
})
