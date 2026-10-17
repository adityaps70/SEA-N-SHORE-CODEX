import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createAccountDeletionRepository } from '@/features/account-deletion/repository'
import { createAccountExportRepository } from '@/features/account-export/repository'
import { createCourseRatingRepository } from './course-rating-repository'
import { createActiveMentor, createAdministrator, createProfile, createPublishedCourse } from './learning-test-fixtures'

/**
 * Round H: course owners reply to reviews (one reply per review) and administrators hide or restore replies, against
 * the real schema (PGlite with every migration, including 0089). Placeholder data only.
 */

let db: TestDatabase
let sequence = 0

beforeAll(async () => {
  db = await createTestDatabase()
}, 180_000)

afterAll(async () => {
  await db?.close()
})

function ratings() {
  return createCourseRatingRepository({ query: db.query, transaction: db.transaction })
}

/** An organization course with an approved owner, administrator and LMS manager, a plain member and an unapproved owner. */
async function organizationCourse() {
  sequence += 1
  const owner = await createProfile(db.query, 'Placeholder Org Owner')
  const orgAdmin = await createProfile(db.query, 'Placeholder Org Admin')
  const member = await createProfile(db.query, 'Placeholder Org Member')
  const pendingOwner = await createProfile(db.query, 'Placeholder Pending Owner')
  const [company] = await db.query(
    `insert into public.companies (slug, name, created_by, is_verified) values ($1, 'Placeholder Marine Org', $2, true) returning id`,
    [`placeholder-reply-org-${sequence}`, owner],
  )
  await db.query(
    `insert into public.company_members (company_id, user_id, role, approved_at)
     values ($1, $2, 'owner', now()), ($1, $3, 'administrator', now()), ($1, $4, 'member', now())`,
    [company!.id, owner, orgAdmin, member],
  )
  await db.query(`insert into public.company_members (company_id, user_id, role, approved_at) values ($1, $2, 'owner', null)`, [company!.id, pendingOwner])
  const [course] = await db.query(
    `insert into public.learning_courses (company_id, created_by_user_id, slug, title, description, category, level, access_type, price_minor, currency, certificate_enabled, status, published_at, approved_at)
     values ($1, $2, $3, 'Placeholder Org Course', 'A placeholder organization course for the round H reply tests.', 'Vetting & Inspections', 'beginner', 'free', 0, 'INR', false, 'published', now(), now()) returning id`,
    [company!.id, owner, `placeholder-reply-course-${sequence}`],
  )
  return { courseId: String(course!.id), owner, orgAdmin, member, pendingOwner }
}

async function review(courseId: string, status: 'approved' | 'pending' = 'approved') {
  const learner = await createProfile(db.query, 'Placeholder Learner')
  const [row] = await db.query(
    `insert into public.learning_course_reviews (course_id, learner_id, rating, body, status) values ($1, $2, 4, 'Placeholder review text.', $3) returning id`,
    [courseId, learner, status],
  )
  return { reviewId: String(row!.id), learner }
}

async function auditActions(reviewId: string) {
  const rows = await db.query(`select action, actor_id, metadata from public.audit_events where target_type = 'course_review' and target_id = $1 order by created_at, id`, [reviewId])
  return rows
}

describe('course owner replies to reviews (round H)', () => {
  it('lets the course owner reply, and refuses another member, an unapproved owner and the reviewer', async () => {
    const course = await organizationCourse()
    const { reviewId, learner } = await review(course.courseId)
    const repository = ratings()

    for (const actor of [course.member, course.pendingOwner, learner]) {
      await expect(repository.saveReply(actor, { reviewId, body: 'Not allowed.', mode: 'add' })).rejects.toThrow('reply_forbidden')
      expect(await repository.getOwnerReplyView(actor, course.courseId)).toBeNull()
    }
    const saved = await repository.saveReply(course.owner, { reviewId, body: '  Thank you for the feedback.  ', mode: 'add' })
    expect(saved).toMatchObject({ reviewId, courseId: course.courseId, reply: { body: 'Thank you for the feedback.', status: 'visible' } })
    // An approved administrator of the organization may edit it; members still cannot delete it.
    await repository.saveReply(course.orgAdmin, { reviewId, body: 'Thank you, we added more examples.', mode: 'edit' })
    await expect(repository.deleteReply(course.member, { reviewId })).rejects.toThrow('reply_forbidden')
    await expect(repository.deleteReply(learner, { reviewId })).rejects.toThrow('reply_forbidden')

    const [row] = await db.query(`select owner_reply, owner_replied_by, owner_replied_at is not null as dated, owner_reply_status from public.learning_course_reviews where id = $1`, [reviewId])
    expect(row).toEqual({ owner_reply: 'Thank you, we added more examples.', owner_replied_by: course.orgAdmin, dated: true, owner_reply_status: 'visible' })
  }, 120_000)

  it('lets a trainer reply to reviews of their own course only', async () => {
    const trainer = await createActiveMentor(db.query)
    const course = await createPublishedCourse(db.query, trainer)
    const otherTrainer = await createActiveMentor(db.query)
    const { reviewId } = await review(course.courseId)
    const repository = ratings()

    await expect(repository.saveReply(otherTrainer.userId, { reviewId, body: 'Not my course.', mode: 'add' })).rejects.toThrow('reply_forbidden')
    await expect(repository.saveReply(trainer.userId, { reviewId, body: 'Thanks for taking the course.', mode: 'add' })).resolves.toMatchObject({ reply: { body: 'Thanks for taking the course.' } })
    expect(await repository.getOwnerReplyView(trainer.userId, course.courseId)).toEqual({
      replies: { [reviewId]: expect.objectContaining({ body: 'Thanks for taking the course.', status: 'visible' }) },
    })
  }, 120_000)

  it('keeps one reply per review and replies only to published reviews', async () => {
    const course = await organizationCourse()
    const { reviewId } = await review(course.courseId)
    const pending = await review(course.courseId, 'pending')
    const repository = ratings()

    await expect(repository.saveReply(course.owner, { reviewId: pending.reviewId, body: 'Too early.', mode: 'add' })).rejects.toThrow('reply_review_not_public')
    await expect(repository.saveReply(course.owner, { reviewId, body: 'Edit before add.', mode: 'edit' })).rejects.toThrow('reply_not_found')
    await repository.saveReply(course.owner, { reviewId, body: 'First reply.', mode: 'add' })
    await expect(repository.saveReply(course.orgAdmin, { reviewId, body: 'Second reply.', mode: 'add' })).rejects.toThrow('reply_exists')
    await repository.saveReply(course.owner, { reviewId, body: 'First reply, edited.', mode: 'edit' })
    // Saving the same words again changes nothing and writes no audit row.
    await repository.saveReply(course.owner, { reviewId, body: 'First reply, edited.', mode: 'edit' })
    await expect(repository.saveReply(course.owner, { reviewId, body: '   ', mode: 'edit' })).rejects.toThrow('reply_invalid')
    await expect(repository.saveReply(course.owner, { reviewId, body: 'x'.repeat(2001), mode: 'edit' })).rejects.toThrow('reply_invalid')

    const rows = await db.query(`select owner_reply from public.learning_course_reviews where id = $1`, [reviewId])
    expect(rows).toEqual([{ owner_reply: 'First reply, edited.' }])
    expect((await auditActions(reviewId)).map((row) => row.action)).toEqual(['learning.course_review_reply_added', 'learning.course_review_reply_edited'])

    await repository.deleteReply(course.owner, { reviewId })
    await expect(repository.deleteReply(course.owner, { reviewId })).rejects.toThrow('reply_not_found')
    expect((await db.query(`select owner_reply, owner_replied_at, owner_replied_by from public.learning_course_reviews where id = $1`, [reviewId]))[0])
      .toEqual({ owner_reply: null, owner_replied_at: null, owner_replied_by: null })
  }, 120_000)

  it('shows a visible reply publicly; an administrator hides and restores it, and hiding survives owner edits', async () => {
    const course = await organizationCourse()
    const { reviewId } = await review(course.courseId)
    const adminId = await createAdministrator(db.query)
    const repository = ratings()

    await repository.saveReply(course.owner, { reviewId, body: 'We fixed the audio in module 2.', mode: 'add' })
    const shown = await repository.getPublicReviews(course.courseId)
    expect(shown.reviews.find((item) => item.id === reviewId)?.reply).toEqual({ body: 'We fixed the audio in module 2.', repliedAt: expect.any(String) })

    await expect(repository.setReplyStatus(course.owner, { reviewId, status: 'hidden', note: null })).rejects.toThrow('admin_forbidden')
    await expect(repository.listReviewReplies(course.owner)).rejects.toThrow('admin_forbidden')
    const listed = (await repository.listReviewReplies(adminId)).find((item) => item.reviewId === reviewId)
    expect(listed).toMatchObject({ body: 'We fixed the audio in module 2.', status: 'visible', publisherName: 'Placeholder Marine Org', reviewRating: 4 })

    await repository.setReplyStatus(adminId, { reviewId, status: 'hidden', note: 'Contains a phone number.' })
    await expect(repository.setReplyStatus(adminId, { reviewId, status: 'hidden', note: null })).rejects.toThrow('reply_status_unchanged')
    expect((await repository.getPublicReviews(course.courseId)).reviews.find((item) => item.id === reviewId)?.reply).toBeNull()
    expect((await repository.getOwnerReplyView(course.owner, course.courseId))?.replies[reviewId]).toMatchObject({ status: 'hidden' })

    // The owner edits, then deletes and writes again: it stays hidden until an administrator restores it.
    await repository.saveReply(course.owner, { reviewId, body: 'We fixed the audio in module 2. Write to us here.', mode: 'edit' })
    await repository.deleteReply(course.owner, { reviewId })
    const again = await repository.saveReply(course.owner, { reviewId, body: 'We fixed the audio in module 2.', mode: 'add' })
    expect(again.reply?.status).toBe('hidden')
    expect((await repository.getPublicReviews(course.courseId)).reviews.find((item) => item.id === reviewId)?.reply).toBeNull()

    await repository.setReplyStatus(adminId, { reviewId, status: 'visible', note: null })
    expect((await repository.getPublicReviews(course.courseId)).reviews.find((item) => item.id === reviewId)?.reply?.body).toBe('We fixed the audio in module 2.')

    const audit = await auditActions(reviewId)
    expect(audit.map((row) => [row.action, row.actor_id])).toEqual([
      ['learning.course_review_reply_added', course.owner],
      ['moderation.course_review_reply_hidden', adminId],
      ['learning.course_review_reply_edited', course.owner],
      ['learning.course_review_reply_deleted', course.owner],
      ['learning.course_review_reply_added', course.owner],
      ['moderation.course_review_reply_restored', adminId],
    ])
    expect(audit[1]!.metadata).toEqual({ courseId: course.courseId, note: 'Contains a phone number.' })
    // No reply text or names in the audit log.
    expect(JSON.stringify(audit.map((row) => row.metadata))).not.toContain('audio')
  }, 120_000)

  it('enforces the reply rules in the database (0089)', async () => {
    const course = await organizationCourse()
    const { reviewId } = await review(course.courseId)
    const refused = async (sql: string, values: unknown[]) => {
      await expect(db.query(sql, values)).rejects.toThrow()
    }
    await refused(`update public.learning_course_reviews set owner_reply = '', owner_replied_at = now() where id = $1`, [reviewId])
    await refused(`update public.learning_course_reviews set owner_reply = '   ', owner_replied_at = now() where id = $1`, [reviewId])
    await refused(`update public.learning_course_reviews set owner_reply = repeat('x', 2001), owner_replied_at = now() where id = $1`, [reviewId])
    await refused(`update public.learning_course_reviews set owner_reply = 'Placeholder reply.' where id = $1`, [reviewId])
    await refused(`update public.learning_course_reviews set owner_reply_status = 'removed' where id = $1`, [reviewId])
    await db.query(`update public.learning_course_reviews set owner_reply = repeat('x', 2000), owner_replied_at = now() where id = $1`, [reviewId])
    expect((await db.query(`select owner_reply_status from public.learning_course_reviews where id = $1`, [reviewId]))[0]).toEqual({ owner_reply_status: 'visible' })
  }, 120_000)

  it('leaves who replied out of the reviewer’s export and forgets it when the replier deletes their account', async () => {
    const course = await organizationCourse()
    const { reviewId, learner } = await review(course.courseId)
    await ratings().saveReply(course.orgAdmin, { reviewId, body: 'Placeholder reply for the export.', mode: 'add' })

    const exported = await createAccountExportRepository({ query: db.query }).exportAccountData(learner)
    expect(exported.learningCourseReviews).toEqual([expect.objectContaining({ id: reviewId, owner_reply: 'Placeholder reply for the export.' })])
    expect(JSON.stringify(exported.learningCourseReviews)).not.toContain('owner_replied_by')

    await createAccountDeletionRepository({ transaction: db.transaction, query: db.query }).deleteAccountWithIdentity(course.orgAdmin, async () => {})
    expect((await db.query(`select owner_reply, owner_replied_by from public.learning_course_reviews where id = $1`, [reviewId]))[0])
      .toEqual({ owner_reply: 'Placeholder reply for the export.', owner_replied_by: null })
  }, 120_000)
})
