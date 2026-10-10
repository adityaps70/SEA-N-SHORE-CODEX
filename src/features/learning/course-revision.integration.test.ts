import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createLearningAdminRepository } from './admin-repository'
import { createCourseRepository, type CourseDraftInput } from './course-repository'
import { createCourseRevisionRepository } from './course-revision-repository'
import { createEnrollmentRepository } from './enrollment-repository'
import { createLearnerCourseRepository } from './learner-course-repository'
import { finalizeEnrollmentIfComplete } from './learner-progress-repository'
import { createMarketplaceRepository } from './marketplace-repository'
import { createMentorCurriculumRepository } from './mentor-curriculum-repository'
import { createMentorMaterialRepository, type MentorMaterial, type MentorMaterialDraft } from './mentor-material-repository'
import {
  completeLessons,
  createActiveMentor,
  createAdministrator,
  createProfile,
  createPublishedCourse,
  enrollLearner,
  recordQuizAttempt,
  type FixtureCourse,
} from './learning-test-fixtures'

/**
 * Editing a published course, end to end against the real Aurora schema (PGlite): start a draft
 * revision, edit it, submit, approve, and check what every enrolled learner sees before and after.
 */

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

function repositories() {
  const deps = { query: db.query, transaction: db.transaction }
  return {
    courses: createCourseRepository(deps),
    revisions: createCourseRevisionRepository(deps),
    curriculum: createMentorCurriculumRepository(deps),
    materials: createMentorMaterialRepository(deps),
    admin: createLearningAdminRepository(deps),
    learner: createLearnerCourseRepository({ query: db.query }),
    enrollments: createEnrollmentRepository({ query: db.query }),
    marketplace: createMarketplaceRepository({ query: db.query }),
  }
}

function draftOf(material: MentorMaterial): MentorMaterialDraft {
  const { id: _id, position: _position, quiz: _quiz, scorm: _scorm, ...draft } = material
  void _id; void _position; void _quiz; void _scorm
  return draft
}

async function detailsDraft(courseId: string, actorId: string): Promise<CourseDraftInput & { revision: number }> {
  const course = await repositories().courses.getOwnedCourse(actorId, courseId)
  if (!course) throw new Error('course missing')
  return {
    slug: course.slug,
    title: course.title,
    subtitle: course.subtitle,
    description: course.description,
    category: course.category,
    level: course.level,
    language: course.language,
    thumbnailPath: course.thumbnailPath,
    trailerPath: course.trailerPath,
    learningOutcomes: course.learningOutcomes,
    requirements: course.requirements,
    targetAudience: course.targetAudience,
    accessType: course.accessType,
    priceMinor: course.priceMinor,
    discountPriceMinor: course.discountPriceMinor,
    currency: course.currency,
    certificateEnabled: course.certificateEnabled,
    courseFormat: course.courseFormat,
    revision: course.detailsRevision,
  }
}

async function learnerView(learnerId: string, slug: string) {
  const course = await repositories().learner.getLearnerCourse(learnerId, slug)
  if (!course) return null
  return {
    totalLessons: course.totalLessons,
    completedLessons: course.completedLessons,
    progressPercent: course.progressPercent,
    enrollmentStatus: course.enrollmentStatus,
    titles: course.sections.flatMap((section) => section.lessons.map((lesson) => lesson.title)),
    ids: course.sections.flatMap((section) => section.lessons.map((lesson) => lesson.id)),
  }
}

async function certificateCount(enrollmentId: string) {
  const rows = await db.query(`select count(*)::int as count from public.learning_certificates where enrollment_id = $1`, [enrollmentId])
  return Number(rows[0]!.count)
}

async function startAndOpenRevision(trainerId: string, course: FixtureCourse) {
  const { revisions, materials } = repositories()
  const started = await revisions.startRevision(trainerId, course.courseId)
  const curriculum = await materials.getCurriculum(trainerId, started.revisionCourseId)
  if (!curriculum) throw new Error('revision curriculum missing')
  const byTitle = new Map(curriculum.sections.flatMap((section) => section.materials).map((material) => [material.title, material]))
  return { revisionId: started.revisionCourseId, curriculum, byTitle }
}

describe('editing a published course through a draft revision', () => {
  it('keeps every enrolled learner’s progress, attempts and certificates through an edit with 10 learners', async () => {
    const { courses, revisions, curriculum: curriculumRepository, materials, admin, learner } = repositories()
    const trainer = await createActiveMentor(db.query)
    const adminId = await createAdministrator(db.query)
    const course = await createPublishedCourse(db.query, trainer, { priceMinor: 0 })
    const order = ['intro', 'video', 'quiz', 'checklist', 'assignment', 'wrapUp'].map((key) => course.lessons[key]!)

    // Ten learners, each with a different amount of progress (0 to 6 of 6 materials, some repeated).
    const learners = [] as Array<{ learnerId: string; enrollmentId: string; completed: string[] }>
    for (let index = 0; index < 10; index += 1) {
      const enrolled = await enrollLearner(db.query, course.courseId, `Learner ${index + 1}`)
      const completed = order.slice(0, index % 7)
      await completeLessons(db.query, enrolled.enrollmentId, completed)
      await db.transaction((query) => finalizeEnrollmentIfComplete(query, enrolled.enrollmentId, course.courseId))
      learners.push({ ...enrolled, completed })
    }
    const quizTaker = learners[3]!
    const attemptId = await recordQuizAttempt(db.query, {
      quizId: course.quiz!.quizId,
      enrollmentId: quizTaker.enrollmentId,
      learnerId: quizTaker.learnerId,
      answers: [{ questionId: course.quiz!.questionIds[0]!, optionId: course.quiz!.optionIds[0]![0]!, correctOptionId: course.quiz!.optionIds[0]![0]! }],
    })
    const finished = learners.find((entry) => entry.completed.length === 6)!
    expect(await certificateCount(finished.enrollmentId)).toBe(1)

    const before = await Promise.all(learners.map((entry) => learnerView(entry.learnerId, course.slug)))
    expect(before.map((view) => view!.progressPercent)).toEqual([0, 17, 33, 50, 67, 83, 100, 0, 17, 33])

    // The trainer opens a draft revision and edits it.
    const { revisionId, byTitle } = await startAndOpenRevision(trainer.userId, course)
    expect(revisionId).not.toBe(course.courseId)
    // Starting again reopens the same draft.
    expect((await revisions.startRevision(trainer.userId, course.courseId)).revisionCourseId).toBe(revisionId)

    const intro = byTitle.get('Intro')!
    await materials.updateMaterial(trainer.userId, revisionId, intro.id, { ...draftOf(intro), title: 'Introduction', articleBody: 'Welcome aboard.' })
    const quiz = byTitle.get('Knowledge check')!
    const question = quiz.quiz!.questions[0]!
    await curriculumRepository.saveQuizDefinition(trainer.userId, revisionId, quiz.id, {
      passPercentage: 70,
      instructions: 'Answer the question.',
      questions: [{
        id: question.id,
        prompt: 'Which document should you read first?',
        options: [
          ...question.options.map((option) => ({ id: option.id, label: option.label, isCorrect: option.isCorrect })),
          { label: 'The crew list', isCorrect: false },
        ],
      }],
    })
    const wrapUp = byTitle.get('Wrap-up')!
    await curriculumRepository.deleteLesson(trainer.userId, revisionId, wrapUp.id)
    const checklist = byTitle.get('Checklist')!
    const revisionSections = (await materials.getCurriculum(trainer.userId, revisionId))!.sections
    await materials.createMaterial(trainer.userId, revisionId, revisionSections[1]!.id, {
      ...draftOf(checklist),
      title: 'New bonus reading',
      articleBody: 'Fresh material added after publishing.',
    })
    const details = await detailsDraft(revisionId, trainer.userId)
    await courses.updateCourse(trainer.userId, revisionId, { ...details, accessType: 'paid', priceMinor: 249900, slug: 'an-attempt-to-change-the-address' }, { expectedRevision: details.revision })

    // Learners still see the live course, untouched, while the trainer edits.
    const during = await Promise.all(learners.map((entry) => learnerView(entry.learnerId, course.slug)))
    expect(during).toEqual(before)
    // The studio lists one course (the live one) with its open draft.
    const listed = await courses.listOwnedCourses(trainer.userId)
    expect(listed.map((item) => item.id)).toEqual([course.courseId])
    expect(listed[0]!.openRevision).toEqual({ courseId: revisionId, status: 'draft' })

    await courses.submitCourse(trainer.userId, revisionId)
    const queue = await admin.listCoursesForReview(adminId, 'submitted')
    const item = queue.find((entry) => entry.courseId === revisionId)!
    expect(item.revisionOf).toEqual({ courseId: course.courseId, slug: course.slug, title: 'Fixture SIRE Readiness' })
    const changes = item.review.changesFromLiveCourse!
    expect(changes).toEqual(expect.arrayContaining([
      // Round C: a course that becomes paid gets its first pricing plan, which the reviewer sees too.
      { area: 'details', change: 'changed', label: 'Course details', fields: ['Access type', 'Price', 'Pricing plans and access periods'] },
      { area: 'material', change: 'changed', label: 'Introduction', fields: ['title', 'article content'] },
      { area: 'material', change: 'changed', label: 'Knowledge check', fields: ['quiz questions'] },
      { area: 'material', change: 'added', label: 'New bonus reading', fields: [] },
      { area: 'material', change: 'removed', label: 'Wrap-up', fields: [] },
    ]))
    expect(changes).toHaveLength(5)

    await admin.reviewCourse(adminId, revisionId, 'approved', null)

    // Ids are stable: every kept material is the same row learners' progress points at.
    const after = await Promise.all(learners.map((entry) => learnerView(entry.learnerId, course.slug)))
    const liveIds = after[0]!.ids
    expect(liveIds.slice(0, 5)).toEqual(order.slice(0, 5))
    expect(liveIds).toHaveLength(6)
    expect(liveIds).not.toContain(course.lessons.wrapUp)
    expect(after[0]!.titles).toEqual(['Introduction', 'Walkthrough video', 'Knowledge check', 'Checklist', 'Inspection report', 'New bonus reading'])

    // Everyone's percentage: completed materials that still count, over the 6 that count now.
    for (const [index, entry] of learners.entries()) {
      const stillCounting = entry.completed.filter((id) => id !== course.lessons.wrapUp).length
      expect(after[index]!.completedLessons).toBe(stillCounting)
      expect(after[index]!.totalLessons).toBe(6)
      expect(after[index]!.progressPercent).toBe(Math.round((stillCounting / 6) * 100))
    }
    // The learner who had finished keeps their completion and certificate.
    expect(after[learners.indexOf(finished)]!.enrollmentStatus).toBe('completed')
    expect(await certificateCount(finished.enrollmentId)).toBe(1)

    // The removed material is retired, never deleted: its progress history stays.
    const retired = await db.query(`select removed_at, is_published from public.learning_lessons where id = $1`, [course.lessons.wrapUp])
    expect(retired[0]!.removed_at).not.toBeNull()
    expect(retired[0]!.is_published).toBe(false)
    const history = await db.query(`select count(*)::int as count from public.learning_progress where lesson_id = $1`, [course.lessons.wrapUp])
    expect(Number(history[0]!.count)).toBe(learners.filter((entry) => entry.completed.includes(course.lessons.wrapUp!)).length)

    // The quiz kept its question and options (so the attempt's answers still resolve); one option was added.
    const questions = await db.query(`select id, prompt from public.learning_quiz_questions where quiz_id = $1 and removed_at is null`, [course.quiz!.quizId])
    expect(questions).toEqual([{ id: course.quiz!.questionIds[0], prompt: 'Which document should you read first?' }])
    const options = await db.query(`select id, label from public.learning_quiz_options where question_id = $1 and removed_at is null order by position`, [course.quiz!.questionIds[0]])
    expect(options.map((row) => row.id).slice(0, 2)).toEqual(course.quiz!.optionIds[0])
    expect(options.map((row) => row.label)).toEqual(['The VIQ', 'The logbook', 'The crew list'])
    const answers = await db.query(`select count(*)::int as count from public.learning_quiz_attempt_answers where attempt_id = $1`, [attemptId])
    expect(Number(answers[0]!.count)).toBe(1)

    // The new price applies to new purchases; the live address never changed.
    const live = await db.query(`select slug, price_minor, access_type, status from public.learning_courses where id = $1`, [course.courseId])
    expect({ ...live[0], price_minor: Number(live[0]!.price_minor) }).toEqual({ slug: course.slug, price_minor: 249900, access_type: 'paid', status: 'published' })

    // The revision is closed and kept as a record; it no longer appears anywhere as a course.
    const closed = await db.query(`select status, revision_outcome from public.learning_courses where id = $1`, [revisionId])
    expect(closed[0]).toEqual({ status: 'archived', revision_outcome: 'merged' })
    expect((await courses.listOwnedCourses(trainer.userId))[0]!.openRevision).toBeNull()
    expect((await admin.listCoursesForReview(adminId, 'archived')).map((entry) => entry.courseId)).not.toContain(revisionId)
    await expect(courses.submitCourse(trainer.userId, revisionId)).rejects.toThrow('course_submit_forbidden')
    void learner
  }, 120_000)

  it('completes a learner whose only unfinished material was removed, and issues the certificate', async () => {
    const { revisions, curriculum: curriculumRepository, courses, admin } = repositories()
    const trainer = await createActiveMentor(db.query)
    const adminId = await createAdministrator(db.query)
    const course = await createPublishedCourse(db.query, trainer)
    const everythingButWrapUp = ['intro', 'video', 'quiz', 'checklist', 'assignment'].map((key) => course.lessons[key]!)
    const learner = await enrollLearner(db.query, course.courseId, 'Learner A')
    await completeLessons(db.query, learner.enrollmentId, everythingButWrapUp)
    expect((await learnerView(learner.learnerId, course.slug))!.progressPercent).toBe(83)

    const { revisionId, byTitle } = await startAndOpenRevision(trainer.userId, course)
    await curriculumRepository.deleteLesson(trainer.userId, revisionId, byTitle.get('Wrap-up')!.id)
    await courses.submitCourse(trainer.userId, revisionId)
    await admin.reviewCourse(adminId, revisionId, 'approved', null)
    void revisions

    const view = await learnerView(learner.learnerId, course.slug)
    expect(view).toMatchObject({ totalLessons: 5, completedLessons: 5, progressPercent: 100, enrollmentStatus: 'completed' })
    expect(await certificateCount(learner.enrollmentId)).toBe(1)
  }, 120_000)

  it('sends changes back to the trainer without touching the live course, and lets them discard the draft', async () => {
    const { revisions, materials, courses, admin } = repositories()
    const trainer = await createActiveMentor(db.query)
    const adminId = await createAdministrator(db.query)
    const course = await createPublishedCourse(db.query, trainer)
    const { revisionId, byTitle } = await startAndOpenRevision(trainer.userId, course)
    const intro = byTitle.get('Intro')!
    await materials.updateMaterial(trainer.userId, revisionId, intro.id, { ...draftOf(intro), title: 'Intro (typo fixed)' })
    await courses.submitCourse(trainer.userId, revisionId)
    await admin.reviewCourse(adminId, revisionId, 'changes_requested', 'Please also fix the summary.')

    const revision = await courses.getOwnedCourse(trainer.userId, revisionId)
    expect(revision).toMatchObject({ status: 'changes_requested', revisionOf: { courseId: course.courseId } })
    const live = await db.query(`select title from public.learning_lessons where id = $1`, [course.lessons.intro])
    expect(live[0]!.title).toBe('Intro')

    // Revisions are never published or archived on their own.
    await expect(admin.reviewCourse(adminId, revisionId, 'archived', null)).rejects.toThrow('course_transition_forbidden')

    await revisions.discardRevision(trainer.userId, revisionId)
    expect((await courses.listOwnedCourses(trainer.userId))[0]!.openRevision).toBeNull()
    const again = await revisions.startRevision(trainer.userId, course.courseId)
    expect(again.created).toBe(true)
    expect(again.revisionCourseId).not.toBe(revisionId)
  }, 120_000)

  it('gives a draft copy of a long-addressed course a valid private address', async () => {
    const { revisions } = repositories()
    const trainer = await createActiveMentor(db.query)
    // 99 letters then a hyphen at position 100: cutting at 100 must not leave a double hyphen.
    const slug = `${'a'.repeat(99)}-b-${'c'.repeat(15)}`
    const course = await createPublishedCourse(db.query, trainer, { slug })
    const { revisionCourseId } = await revisions.startRevision(trainer.userId, course.courseId)
    const rows = await db.query(`select slug from public.learning_courses where id = $1`, [revisionCourseId])
    expect(rows[0]!.slug).toMatch(new RegExp(`^${'a'.repeat(99)}-draft-[0-9a-f]{8}$`))
  }, 120_000)

  it('only lets the course’s own managers open a revision, and only of a published course', async () => {
    const { revisions } = repositories()
    const trainer = await createActiveMentor(db.query)
    const stranger = await createProfile(db.query, 'Fixture Stranger')
    const course = await createPublishedCourse(db.query, trainer)
    await expect(revisions.startRevision(stranger, course.courseId)).rejects.toThrow('course_not_found')
    await db.query(`update public.learning_courses set status = 'draft' where id = $1`, [course.courseId])
    await expect(revisions.startRevision(trainer.userId, course.courseId)).rejects.toThrow('course_revision_not_published')
  }, 120_000)
})

describe('archiving a course', () => {
  it('hides it from the catalogue and new learners, keeps enrolled learners’ access, and can be undone', async () => {
    const { admin, marketplace, enrollments } = repositories()
    const trainer = await createActiveMentor(db.query)
    const adminId = await createAdministrator(db.query)
    const course = await createPublishedCourse(db.query, trainer)
    const enrolled = await enrollLearner(db.query, course.courseId, 'Learner B')
    await completeLessons(db.query, enrolled.enrollmentId, [course.lessons.intro!])
    const newcomer = await createProfile(db.query, 'Learner C')

    await admin.reviewCourse(adminId, course.courseId, 'archived', null)
    expect(await marketplace.getPublishedCourseBySlug(course.slug)).toBeNull()
    await expect(enrollments.enrollFreeCourse(newcomer, course.courseId)).rejects.toThrow()
    const view = await learnerView(enrolled.learnerId, course.slug)
    expect(view).toMatchObject({ completedLessons: 1, totalLessons: 6 })

    await admin.reviewCourse(adminId, course.courseId, 'published', null)
    expect((await marketplace.getPublishedCourseBySlug(course.slug))?.id).toBe(course.courseId)
    await enrollments.enrollFreeCourse(newcomer, course.courseId)
  }, 120_000)
})
