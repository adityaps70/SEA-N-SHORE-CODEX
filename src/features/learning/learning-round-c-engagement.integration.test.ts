import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createAccountDeletionRepository } from '@/features/account-deletion/repository'
import { createAccountExportRepository } from '@/features/account-export/repository'
import { createAdminRepository } from '@/features/admin/repository'
import { createModerationRepository } from '@/features/moderation/repository'
import { createCourseAnnouncementRepository } from './course-announcement-repository'
import { createCourseCommunityRepository } from './course-community-repository'
import { createCourseRatingRepository } from './course-rating-repository'
import { createLearningEmailPreferences, createLearningEmailRepository, createLearningEmailWorker } from './learning-email-sending'
import { notifyCourseAnnouncement } from './learning-notifications'
import { completeLessons, createActiveMentor, createAdministrator, createProfile, createPublishedCourse, enrollLearner } from './learning-test-fixtures'

/**
 * Learning round C (C5a ratings and reviews, C5b announcements, C7 course communities) against the real schema
 * (PGlite with every migration applied). Fixture names are obviously fake.
 */

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
}, 180_000)

afterAll(async () => {
  await db?.close()
})

function ratings() {
  return createCourseRatingRepository({ query: db.query, transaction: db.transaction })
}

function announcements() {
  return createCourseAnnouncementRepository({ query: db.query, transaction: db.transaction })
}

function communities() {
  return createCourseCommunityRepository({ query: db.query, transaction: db.transaction })
}

async function courseWithLearner(label: string) {
  const trainer = await createActiveMentor(db.query)
  const course = await createPublishedCourse(db.query, trainer)
  const learner = await enrollLearner(db.query, course.courseId, label)
  return { trainer, course, learner }
}

/** Completes two of the fixture course's six published materials (33%). */
async function reachTwentyPercent(course: Awaited<ReturnType<typeof createPublishedCourse>>, enrollmentId: string) {
  await completeLessons(db.query, enrollmentId, [course.lessons.intro!, course.lessons.video!])
}

async function verifyEmail(profileId: string, email: string) {
  await db.query(
    `insert into public.identity_accounts (profile_id, provider, provider_subject, email, email_verified)
     values ($1, 'cognito', gen_random_uuid()::text, $2, true)`,
    [profileId, email],
  )
}

async function createGroup(input: { slug: string; visibility: 'public' | 'private'; ownerId: string; joinPolicy?: 'open' | 'approval' }) {
  const rows = await db.query(
    `insert into public.community_groups (name, slug, visibility, join_policy, created_by)
     values ($1, $2, $3, $4, $5) returning id`,
    [`Fixture ${input.slug}`, input.slug, input.visibility, input.joinPolicy ?? (input.visibility === 'private' ? 'approval' : 'open'), input.ownerId],
  )
  const groupId = rows[0]!.id as string
  await db.query(
    `insert into public.community_group_memberships (group_id, profile_id, role, status, joined_at) values ($1, $2, 'owner', 'active', now())`,
    [groupId, input.ownerId],
  )
  return groupId
}

async function membership(groupId: string, profileId: string) {
  const rows = await db.query(`select role, status from public.community_group_memberships where group_id = $1 and profile_id = $2`, [groupId, profileId])
  return rows[0] ?? null
}

describe('course ratings and reviews (C5a)', () => {
  it('lets a learner rate only after 20% progress, never when revoked or when access has ended', async () => {
    const { course, learner } = await courseWithLearner('Fixture Learner Ada')
    const repository = ratings()

    await completeLessons(db.query, learner.enrollmentId, [course.lessons.intro!])
    const early = await repository.getEligibility(learner.learnerId, course.courseId)
    expect(early).toMatchObject({ canReview: false, reason: 'progress', progressPercent: 16 })
    await expect(repository.saveReview(learner.learnerId, course.courseId, { rating: 5, body: 'Too early.' })).rejects.toThrow('review_progress_too_low')

    await completeLessons(db.query, learner.enrollmentId, [course.lessons.video!])
    expect(await repository.getEligibility(learner.learnerId, course.courseId)).toMatchObject({ canReview: true, reason: null, progressPercent: 33 })
    const saved = await repository.saveReview(learner.learnerId, course.courseId, { rating: 4, body: '  Clear and practical.  ' })
    expect(saved).toMatchObject({ rating: 4, body: 'Clear and practical.', status: 'pending' })

    await db.query(`update public.learning_enrollments set access_expires_at = now() - interval '1 day' where id = $1`, [learner.enrollmentId])
    await expect(repository.saveReview(learner.learnerId, course.courseId, { rating: 3, body: '' })).rejects.toThrow('review_access_ended')
    expect((await repository.getEligibility(learner.learnerId, course.courseId)).reason).toBe('access_ended')

    await db.query(`update public.learning_enrollments set access_expires_at = null, status = 'revoked' where id = $1`, [learner.enrollmentId])
    await expect(repository.saveReview(learner.learnerId, course.courseId, { rating: 3, body: '' })).rejects.toThrow('review_not_enrolled')

    const stranger = await createProfile(db.query, 'Fixture Visitor Bo')
    await expect(repository.saveReview(stranger, course.courseId, { rating: 5, body: '' })).rejects.toThrow('review_not_enrolled')
  }, 120_000)

  it('keeps one review per learner; an edit goes back to pending, saving the same words changes nothing', async () => {
    const { course, learner } = await courseWithLearner('Fixture Learner Cy')
    const adminId = await createAdministrator(db.query)
    const repository = ratings()
    await reachTwentyPercent(course, learner.enrollmentId)

    const first = await repository.saveReview(learner.learnerId, course.courseId, { rating: 5, body: 'Excellent walkthrough.' })
    await repository.decideReview(adminId, { reviewId: first.id, decision: 'approved', note: null, expectedUpdatedAt: first.updatedAt })
    const same = await repository.saveReview(learner.learnerId, course.courseId, { rating: 5, body: 'Excellent walkthrough.' })
    expect(same.status).toBe('approved')

    const edited = await repository.saveReview(learner.learnerId, course.courseId, { rating: 3, body: 'Good, but the quiz is short.' })
    expect(edited).toMatchObject({ id: first.id, rating: 3, status: 'pending' })
    const rows = await db.query(`select status, moderated_by from public.learning_course_reviews where course_id = $1 and learner_id = $2`, [course.courseId, learner.learnerId])
    expect(rows).toEqual([{ status: 'pending', moderated_by: null }])
  }, 120_000)

  it('shows only approved reviews on the course page and in the average; only administrators decide', async () => {
    const trainer = await createActiveMentor(db.query)
    const course = await createPublishedCourse(db.query, trainer)
    const adminId = await createAdministrator(db.query)
    const repository = ratings()
    const reviewIds: Record<string, string> = {}
    for (const [label, rating] of [['Fixture Learner Di', 5], ['Fixture Learner Ed', 3], ['Fixture Learner Fi', 1], ['Fixture Learner Gu', 2]] as const) {
      const learner = await enrollLearner(db.query, course.courseId, label)
      await reachTwentyPercent(course, learner.enrollmentId)
      reviewIds[label] = (await repository.saveReview(learner.learnerId, course.courseId, { rating, body: `${label} says hello.` })).id
    }

    const pending = await repository.listPendingReviews(adminId)
    const ours = pending.filter((review) => review.course.id === course.courseId)
    expect(ours).toHaveLength(4)
    await expect(repository.listPendingReviews(trainer.userId)).rejects.toThrow('admin_forbidden')
    await expect(repository.decideReview(trainer.userId, { reviewId: reviewIds['Fixture Learner Di']!, decision: 'approved', note: null })).rejects.toThrow('admin_forbidden')

    const byId = new Map(ours.map((review) => [review.id, review]))
    await repository.decideReview(adminId, { reviewId: reviewIds['Fixture Learner Di']!, decision: 'approved', note: null, expectedUpdatedAt: byId.get(reviewIds['Fixture Learner Di']!)!.updatedAt })
    await repository.decideReview(adminId, { reviewId: reviewIds['Fixture Learner Ed']!, decision: 'approved', note: null })
    await repository.decideReview(adminId, { reviewId: reviewIds['Fixture Learner Fi']!, decision: 'rejected', note: 'Off topic.' })
    await expect(repository.decideReview(adminId, { reviewId: reviewIds['Fixture Learner Fi']!, decision: 'approved', note: null })).rejects.toThrow('review_not_pending')
    await expect(repository.decideReview(adminId, { reviewId: reviewIds['Fixture Learner Gu']!, decision: 'approved', note: null, expectedUpdatedAt: '2020-01-01T00:00:00.000Z' })).rejects.toThrow('review_changed')

    const approved = await db.query(`select status, moderated_by, moderated_at from public.learning_course_reviews where id = $1`, [reviewIds['Fixture Learner Di']])
    expect(approved[0]).toMatchObject({ status: 'approved', moderated_by: adminId })
    expect(approved[0]!.moderated_at).not.toBeNull()

    const page = await repository.getPublicReviews(course.courseId)
    expect(page.reviewCount).toBe(2)
    expect(page.averageRating).toBe(4)
    expect(page.reviews.map((review) => review.reviewer.name).sort()).toEqual(['Fixture Learner Di', 'Fixture Learner Ed'])
    const audit = await db.query(`select action from public.audit_events where target_type = 'course_review' and target_id = $1`, [reviewIds['Fixture Learner Fi']])
    expect(audit.map((row) => row.action)).toEqual(['moderation.course_review_rejected'])
  }, 120_000)

  it('lets members report an approved review, and moderators remove and restore it through the report queue', async () => {
    const { course, learner } = await courseWithLearner('Fixture Learner Ha')
    const adminId = await createAdministrator(db.query)
    const reporter = await createProfile(db.query, 'Fixture Reporter Io')
    const repository = ratings()
    const moderation = createModerationRepository({ query: db.query })
    const admin = createAdminRepository({ query: db.query, transaction: db.transaction })
    await reachTwentyPercent(course, learner.enrollmentId)
    const review = await repository.saveReview(learner.learnerId, course.courseId, { rating: 2, body: 'Fixture review text.' })

    // A pending review is not public, so it cannot be reported yet.
    await expect(moderation.reportContent({ reporterId: reporter, targetType: 'course_review', targetId: review.id, reason: 'spam', details: null })).rejects.toThrow('moderation_target_unavailable')
    await repository.decideReview(adminId, { reviewId: review.id, decision: 'approved', note: null })
    await expect(moderation.reportContent({ reporterId: learner.learnerId, targetType: 'course_review', targetId: review.id, reason: 'spam', details: null })).rejects.toThrow('moderation_self_report_forbidden')
    await moderation.reportContent({ reporterId: reporter, targetType: 'course_review', targetId: review.id, reason: 'harassment', details: 'Fixture details.' })

    const reports = await db.query(`select target_type, reporter_id, reason, status from public.content_reports where target_id = $1`, [review.id])
    expect(reports).toEqual([{ target_type: 'course_review', reporter_id: reporter, reason: 'harassment', status: 'open' }])

    const cases = await admin.listModerationCases(adminId, { status: 'open', targetType: 'course_review', limit: 50 })
    const ours = cases.find((item) => item.targetId === review.id)
    expect(ours).toMatchObject({ targetType: 'course_review', title: 'Review of Fixture SIRE Readiness by Fixture Learner Ha', targetState: 'visible', owner: { id: learner.learnerId } })
    expect(ours?.excerpt).toContain('2 of 5 stars')

    await admin.moderateContent(adminId, { targetType: 'course_review', targetId: review.id, action: 'remove', note: 'Abusive.' })
    expect((await db.query(`select status from public.learning_course_reviews where id = $1`, [review.id]))[0]!.status).toBe('removed')
    expect((await repository.getPublicReviews(course.courseId)).reviewCount).toBe(0)
    await admin.moderateContent(adminId, { targetType: 'course_review', targetId: review.id, action: 'restore', note: 'Reviewed again.' })
    expect((await db.query(`select status from public.learning_course_reviews where id = $1`, [review.id]))[0]!.status).toBe('approved')
    expect((await repository.getPublicReviews(course.courseId)).reviewCount).toBe(1)
  }, 120_000)

  it('exports a member’s reviews and deletes them, with the reports about them, when the account is deleted', async () => {
    const { course, learner } = await courseWithLearner('Fixture Learner Jo')
    const adminId = await createAdministrator(db.query)
    const reporter = await createProfile(db.query, 'Fixture Reporter Ky')
    const repository = ratings()
    await reachTwentyPercent(course, learner.enrollmentId)
    const review = await repository.saveReview(learner.learnerId, course.courseId, { rating: 4, body: 'Fixture export text.' })
    await repository.decideReview(adminId, { reviewId: review.id, decision: 'approved', note: null })
    await createModerationRepository({ query: db.query }).reportContent({ reporterId: reporter, targetType: 'course_review', targetId: review.id, reason: 'spam', details: null })

    const exported = await createAccountExportRepository({ query: db.query }).exportAccountData(learner.learnerId)
    expect(exported.learningCourseReviews).toEqual([expect.objectContaining({ id: review.id, rating: 4, body: 'Fixture export text.' })])
    expect(JSON.stringify(exported.learningCourseReviews)).not.toContain('moderated_by')

    await createAccountDeletionRepository({ transaction: db.transaction, query: db.query }).deleteAccountWithIdentity(learner.learnerId, async () => {})
    expect(await db.query(`select id from public.learning_course_reviews where id = $1`, [review.id])).toEqual([])
    expect(await db.query(`select id from public.content_reports where target_id = $1`, [review.id])).toEqual([])
  }, 120_000)
})

describe('course announcements (C5b)', () => {
  it('reaches active, completed and expired-access learners once each, never revoked learners or the course team', async () => {
    const trainer = await createActiveMentor(db.query)
    const course = await createPublishedCourse(db.query, trainer)
    const active = await enrollLearner(db.query, course.courseId, 'Fixture Learner La')
    const completed = await enrollLearner(db.query, course.courseId, 'Fixture Learner Mo')
    const expired = await enrollLearner(db.query, course.courseId, 'Fixture Learner Nu')
    const revoked = await enrollLearner(db.query, course.courseId, 'Fixture Learner Ob')
    const team = await enrollLearner(db.query, course.courseId, 'Fixture Team Pa')
    await db.query(`update public.learning_enrollments set status = 'completed', completed_at = now() where id = $1`, [completed.enrollmentId])
    await db.query(`update public.learning_enrollments set access_expires_at = now() - interval '2 days' where id = $1`, [expired.enrollmentId])
    await db.query(`update public.learning_enrollments set status = 'revoked' where id = $1`, [revoked.enrollmentId])
    await db.query(`update public.learning_enrollments set enrollment_source = 'admin' where id = $1`, [team.enrollmentId])

    const posted = await announcements().postAnnouncement(trainer.userId, course.courseId, { title: 'Live Q&A on Saturday', body: 'Join at 10:00 IST.\nBring your questions.' })
    expect(posted.recipientCount).toBe(3)
    const stored = await db.query(`select course_id, author_id, recipient_count from public.learning_course_announcements where id = $1`, [posted.id])
    expect(stored[0]).toEqual({ course_id: course.courseId, author_id: trainer.userId, recipient_count: 3 })

    // A retried delivery never doubles anything.
    await notifyCourseAnnouncement(db.query, { announcementId: posted.id, courseId: course.courseId, recipientIds: [active.learnerId], details: { courseTitle: 'x', courseSlug: 'x' } })

    const notified = await db.query(
      `select recipient_id, count(*)::int as count from public.notifications
       where notification_type = 'learning_announcement' and dedupe_key = $1 group by recipient_id`,
      [`learning_announcement:${posted.id}`],
    )
    expect(new Map(notified.map((row) => [row.recipient_id, row.count]))).toEqual(new Map([[active.learnerId, 1], [completed.learnerId, 1], [expired.learnerId, 1]]))
    const emails = await db.query(
      `select recipient_id, count(*)::int as count from public.learning_notification_emails
       where kind = 'announcement' and dedupe_key like $1 group by recipient_id`,
      [`%learning_announcement:${posted.id}`],
    )
    expect(new Map(emails.map((row) => [row.recipient_id, row.count]))).toEqual(new Map([[active.learnerId, 1], [completed.learnerId, 1], [expired.learnerId, 1]]))

    // The player lists it for learners (expired access included); not for someone whose enrolment was revoked.
    expect((await announcements().listForLearner(expired.learnerId, course.courseId))?.map((item) => item.title)).toEqual(['Live Q&A on Saturday'])
    expect(await announcements().listForLearner(revoked.learnerId, course.courseId)).toBeNull()
  }, 120_000)

  it('allows three announcements per course in 24 hours, and only from the course’s managers (also from a draft revision)', async () => {
    const trainer = await createActiveMentor(db.query)
    const course = await createPublishedCourse(db.query, trainer)
    const otherTrainer = await createActiveMentor(db.query)
    const member = await createProfile(db.query, 'Fixture Member Qi')
    const revision = await db.query(
      `insert into public.learning_courses (mentor_id, created_by_user_id, slug, title, description, category, level, access_type, price_minor, currency, status, revision_of_course_id)
       select mentor_id, created_by_user_id, slug || '-rev', title, description, category, level, access_type, price_minor, currency, 'draft', id
       from public.learning_courses where id = $1 returning id`,
      [course.courseId],
    )
    const repository = announcements()

    await expect(repository.postAnnouncement(member, course.courseId, { title: 'Hello', body: 'Not mine to send.' })).rejects.toThrow('announcement_forbidden')
    await expect(repository.postAnnouncement(otherTrainer.userId, course.courseId, { title: 'Hello', body: 'Not mine either.' })).rejects.toThrow('announcement_forbidden')

    const first = await repository.postAnnouncement(trainer.userId, revision[0]!.id as string, { title: 'One', body: 'First.' })
    expect(first.courseId).toBe(course.courseId)
    await repository.postAnnouncement(trainer.userId, course.courseId, { title: 'Two', body: 'Second.' })
    await repository.postAnnouncement(trainer.userId, course.courseId, { title: 'Three', body: 'Third.' })
    await expect(repository.postAnnouncement(trainer.userId, course.courseId, { title: 'Four', body: 'Fourth.' })).rejects.toThrow('announcement_rate_limited')
    expect((await repository.listForManager(trainer.userId, course.courseId))?.remainingToday).toBe(0)

    // A day later the oldest one no longer counts.
    await db.query(`update public.learning_course_announcements set created_at = now() - interval '25 hours' where id = $1`, [first.id])
    await repository.postAnnouncement(trainer.userId, course.courseId, { title: 'Four', body: 'Fourth, a day later.' })
    const managed = await repository.listForManager(trainer.userId, course.courseId)
    expect(managed?.announcements.map((item) => item.title)).toEqual(['Four', 'Three', 'Two', 'One'])
    expect(await repository.listForManager(member, course.courseId)).toBeNull()
  }, 120_000)

  it('emails each learner once, skips learners who turned Learning emails off, and links to the Announcements tab', async () => {
    const trainer = await createActiveMentor(db.query)
    const course = await createPublishedCourse(db.query, trainer)
    const wants = await enrollLearner(db.query, course.courseId, 'Fixture Learner Ru')
    const optedOut = await enrollLearner(db.query, course.courseId, 'Fixture Learner Sa')
    await verifyEmail(wants.learnerId, 'fixture-ru@example.test')
    await verifyEmail(optedOut.learnerId, 'fixture-sa@example.test')
    await createLearningEmailPreferences({ query: db.query }).setLearningEmails(optedOut.learnerId, false)

    await announcements().postAnnouncement(trainer.userId, course.courseId, { title: 'New checklist added', body: 'Download it from section B.' })

    const sendEmail = vi.fn().mockResolvedValue({ messageId: 'fixture-message' })
    const worker = createLearningEmailWorker({
      repository: createLearningEmailRepository({ query: db.query, transaction: db.transaction }),
      resend: { sendEmail },
      siteUrl: 'https://seanshore.test',
    })
    for (let sweep = 0; sweep < 20; sweep += 1) {
      if ((await worker.runSweep(25)).claimed === 0) break
    }

    const toUs = sendEmail.mock.calls.map((call) => call[0]).filter((email) => ['fixture-ru@example.test', 'fixture-sa@example.test'].includes(email.to))
    expect(toUs).toHaveLength(1)
    expect(toUs[0]).toMatchObject({ to: 'fixture-ru@example.test', subject: 'Fixture SIRE Readiness: New checklist added' })
    expect(toUs[0].text).toContain('Download it from section B.')
    expect(toUs[0].text).toContain(`https://seanshore.test/learn/courses/${course.slug}/learn?tab=announcements`)
    const statuses = await db.query(
      `select recipient_id, status from public.learning_notification_emails where kind = 'announcement' and recipient_id = any($1::uuid[])`,
      [[wants.learnerId, optedOut.learnerId]],
    )
    expect(new Map(statuses.map((row) => [row.recipient_id, row.status]))).toEqual(new Map([[wants.learnerId, 'sent'], [optedOut.learnerId, 'skipped']]))
    // Opting out of emails never hides the in-app notification.
    expect(await db.query(`select 1 from public.notifications where recipient_id = $1 and notification_type = 'learning_announcement'`, [optedOut.learnerId])).toHaveLength(1)
  }, 120_000)
})

describe('course discussion through communities (C7)', () => {
  it('links a course only to a live community its manager owns or administers', async () => {
    const trainer = await createActiveMentor(db.query)
    const course = await createPublishedCourse(db.query, trainer)
    const stranger = await createProfile(db.query, 'Fixture Stranger Te')
    const otherOwner = await createProfile(db.query, 'Fixture Owner Ul')
    const owned = await createGroup({ slug: 'fixture-owned-circle', visibility: 'private', ownerId: trainer.userId })
    const memberOnly = await createGroup({ slug: 'fixture-member-circle', visibility: 'public', ownerId: otherOwner })
    await db.query(`insert into public.community_group_memberships (group_id, profile_id, role, status, joined_at) values ($1, $2, 'member', 'active', now())`, [memberOnly, trainer.userId])
    const archived = await createGroup({ slug: 'fixture-archived-circle', visibility: 'public', ownerId: trainer.userId })
    await db.query(`update public.community_groups set archived_at = now() where id = $1`, [archived])
    const repository = communities()

    await expect(repository.setLink(stranger, course.courseId, owned)).rejects.toThrow('course_not_found')
    await expect(repository.setLink(trainer.userId, course.courseId, memberOnly)).rejects.toThrow('community_not_allowed')
    await expect(repository.setLink(trainer.userId, course.courseId, archived)).rejects.toThrow('community_not_allowed')
    const link = await repository.getLinkForManager(trainer.userId, course.courseId)
    expect(link?.options.map((option) => option.id)).toEqual([owned])
    expect(await repository.getLinkForManager(stranger, course.courseId)).toBeNull()

    await repository.setLink(trainer.userId, course.courseId, owned)
    expect((await db.query(`select community_group_id from public.learning_courses where id = $1`, [course.courseId]))[0]!.community_group_id).toBe(owned)
    expect(await repository.getDiscussion(course.courseId)).toMatchObject({ groupId: owned, visibility: 'private' })
    await repository.setLink(trainer.userId, course.courseId, null)
    expect(await repository.getDiscussion(course.courseId)).toBeNull()
  }, 120_000)

  it('lets enrolled learners into a private community, keeps admins’ roles, and never re-adds a removed member', async () => {
    const trainer = await createActiveMentor(db.query)
    const course = await createPublishedCourse(db.query, trainer)
    const groupId = await createGroup({ slug: 'fixture-private-deck', visibility: 'private', ownerId: trainer.userId })
    await communities().setLink(trainer.userId, course.courseId, groupId)
    const learner = await enrollLearner(db.query, course.courseId, 'Fixture Learner Va')
    const admin = await enrollLearner(db.query, course.courseId, 'Fixture Learner Wu')
    const removed = await enrollLearner(db.query, course.courseId, 'Fixture Learner Xi')
    const outsider = await createProfile(db.query, 'Fixture Outsider Yo')
    const revokedLearner = await enrollLearner(db.query, course.courseId, 'Fixture Learner Ze')
    await db.query(`update public.learning_enrollments set status = 'revoked' where id = $1`, [revokedLearner.enrollmentId])
    await db.query(`insert into public.community_group_memberships (group_id, profile_id, role, status, joined_at) values ($1, $2, 'admin', 'active', now())`, [groupId, admin.learnerId])
    await db.query(`insert into public.community_group_memberships (group_id, profile_id, role, status) values ($1, $2, 'member', 'removed')`, [groupId, removed.learnerId])
    const repository = communities()

    expect(await repository.openDiscussion(learner.learnerId, course.courseId)).toEqual({ slug: 'fixture-private-deck', granted: true })
    expect(await membership(groupId, learner.learnerId)).toEqual({ role: 'member', status: 'active' })
    expect(await repository.openDiscussion(learner.learnerId, course.courseId)).toEqual({ slug: 'fixture-private-deck', granted: false })

    expect(await repository.openDiscussion(admin.learnerId, course.courseId)).toMatchObject({ granted: false })
    expect(await membership(groupId, admin.learnerId)).toEqual({ role: 'admin', status: 'active' })

    await expect(repository.openDiscussion(removed.learnerId, course.courseId)).rejects.toThrow('discussion_removed')
    expect(await membership(groupId, removed.learnerId)).toEqual({ role: 'member', status: 'removed' })

    await expect(repository.openDiscussion(outsider, course.courseId)).rejects.toThrow('discussion_not_enrolled')
    await expect(repository.openDiscussion(revokedLearner.learnerId, course.courseId)).rejects.toThrow('discussion_not_enrolled')
    expect(await membership(groupId, outsider)).toBeNull()
    expect(await membership(groupId, revokedLearner.learnerId)).toBeNull()

    // Owner decision: membership granted through the course stays when the course access ends.
    await db.query(`update public.learning_enrollments set access_expires_at = now() - interval '1 day' where id = $1`, [learner.enrollmentId])
    expect(await membership(groupId, learner.learnerId)).toEqual({ role: 'member', status: 'active' })
  }, 120_000)
})
