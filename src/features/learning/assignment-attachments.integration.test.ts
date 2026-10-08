import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { buildAssignmentAttachmentPath } from './assignment-policy'
import { createAssignmentGradingRepository } from './assignment-grading-repository'
import { createLearnerAssignmentRepository } from './learner-assignment-repository'
import {
  createActiveMentor,
  createAdministrator,
  createPublishedCourse,
  enrollLearner,
} from './learning-test-fixtures'

/**
 * Assignment file submissions against the real schema (PGlite): who may download a learner's files,
 * the per-assignment file count, and the per-submission storage prefix.
 */

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

async function scenario() {
  const repository = createLearnerAssignmentRepository({ query: db.query, transaction: db.transaction })
  const trainer = await createActiveMentor(db.query)
  const course = await createPublishedCourse(db.query, trainer)
  const learner = await enrollLearner(db.query, course.courseId, 'Learner 1')
  const otherLearner = await enrollLearner(db.query, course.courseId, 'Learner 2')
  return { repository, trainer, course, learner, otherLearner }
}

function file(target: { enrollmentId: string; lessonId: string }, submissionId: string, name: string, extension = 'pdf') {
  return {
    storagePath: buildAssignmentAttachmentPath({ ...target, submissionId, extension }),
    fileName: name,
    contentType: extension === 'pdf' ? 'application/pdf' : 'image/jpeg',
    sizeBytes: 2048,
  }
}

describe('assignment file submissions', () => {
  it('stores files under the submission and lets only the learner, the course’s trainers and admins download them', async () => {
    const { repository, trainer, course, learner, otherLearner } = await scenario()
    const lessonId = course.lessons.assignment!
    const target = await repository.getSubmissionTarget(learner.learnerId, course.slug, lessonId)
    expect(target.rules).toEqual({ acceptedExtensions: ['.pdf'], maxUploadBytes: 10485760, maxFiles: 5 })

    const submissionId = crypto.randomUUID()
    const result = await repository.submit(learner.learnerId, course.slug, lessonId, {
      responseText: null,
      submissionId,
      attachments: [file(target, submissionId, 'report.pdf'), file(target, submissionId, 'annex.pdf')],
    })
    // The attempt is the submission: its id is the prefix the files were uploaded under.
    expect(result.attemptId).toBe(submissionId)

    const state = await repository.getState(learner.learnerId, course.slug, lessonId)
    expect(state!.reviewPending).toBe(true)
    expect(state!.latestAttempt!.attachments.map((attachment) => attachment.fileName)).toEqual(['report.pdf', 'annex.pdf'])
    const attachmentId = state!.latestAttempt!.attachments[0]!.id

    const admin = await createAdministrator(db.query)
    const otherTrainer = await createActiveMentor(db.query)
    expect(await repository.getAttachmentForViewer(learner.learnerId, attachmentId)).toMatchObject({ fileName: 'report.pdf', contentType: 'application/pdf' })
    expect(await repository.getAttachmentForViewer(trainer.userId, attachmentId)).toMatchObject({ fileName: 'report.pdf' })
    expect(await repository.getAttachmentForViewer(admin, attachmentId)).toMatchObject({ fileName: 'report.pdf' })
    expect(await repository.getAttachmentForViewer(otherLearner.learnerId, attachmentId)).toBeNull()
    expect(await repository.getAttachmentForViewer(otherTrainer.userId, attachmentId)).toBeNull()

    // The trainer's grading view lists the files.
    const grading = createAssignmentGradingRepository({ query: db.query, transaction: db.transaction })
    const review = await grading.getForMentor(trainer.userId, submissionId)
    expect(review!.attachments.map((attachment) => attachment.fileName)).toEqual(['report.pdf', 'annex.pdf'])
    expect(await grading.getForMentor(otherTrainer.userId, submissionId)).toBeNull()
  }, 120_000)

  it('refuses more files than the assignment allows, and files from another submission or learner', async () => {
    const { repository, course, learner, otherLearner } = await scenario()
    const lessonId = course.lessons.assignment!
    await db.query(`update public.learning_assignments set max_files = 2 where lesson_id = $1`, [lessonId])
    const target = await repository.getSubmissionTarget(learner.learnerId, course.slug, lessonId)
    const submissionId = crypto.randomUUID()

    await expect(repository.submit(learner.learnerId, course.slug, lessonId, {
      responseText: null,
      submissionId,
      attachments: ['a.pdf', 'b.pdf', 'c.pdf'].map((name) => file(target, submissionId, name)),
    })).rejects.toThrow('assignment_too_many_files')

    const elsewhere = file(target, crypto.randomUUID(), 'other-submission.pdf')
    await expect(repository.submit(learner.learnerId, course.slug, lessonId, {
      responseText: null,
      submissionId,
      attachments: [elsewhere],
    })).rejects.toThrow('assignment_attachment_invalid')

    const otherTarget = await repository.getSubmissionTarget(otherLearner.learnerId, course.slug, lessonId)
    await expect(repository.submit(learner.learnerId, course.slug, lessonId, {
      responseText: null,
      submissionId,
      attachments: [file(otherTarget, submissionId, 'someone-elses.pdf')],
    })).rejects.toThrow('assignment_attachment_invalid')

    const attempts = await db.query(`select count(*)::int as count from public.learning_assignment_attempts where lesson_id = $1`, [lessonId])
    expect(Number(attempts[0]!.count)).toBe(0)
  }, 120_000)

  it('still accepts a written response with no files', async () => {
    const { repository, course, learner } = await scenario()
    const result = await repository.submit(learner.learnerId, course.slug, course.lessons.assignment!, {
      responseText: 'My inspection notes.',
      attachments: [],
    })
    const rows = await db.query(`select attachment_path, response_text from public.learning_assignment_attempts where id = $1`, [result.attemptId])
    expect(rows[0]).toEqual({ attachment_path: null, response_text: 'My inspection notes.' })
  }, 120_000)
})
