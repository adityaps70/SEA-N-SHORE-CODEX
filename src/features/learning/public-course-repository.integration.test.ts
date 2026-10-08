import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createMarketplaceRepository } from './marketplace-repository'
import { createPublicCourseRepository } from './public-course-repository'
import { createActiveMentor, createPublishedCourse } from './learning-test-fixtures'

/**
 * Public course pages and free previews against the real schema (PGlite). These checks run in SQL,
 * so a visitor can't reach material content by guessing ids.
 */

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

async function publicCourse() {
  const trainer = await createActiveMentor(db.query)
  const course = await createPublishedCourse(db.query, trainer)
  await db.query(`update public.learning_courses set is_discoverable = true, thumbnail_path = $2 where id = $1`, [
    course.courseId,
    `learning/${trainer.userId}/${course.courseId}/course_thumbnail/11111111-1111-4111-8111-111111111111.png`,
  ])
  // Intro and the video are free previews; the quiz is marked preview too, but activities never preview.
  await db.query(`update public.learning_lessons set is_preview = true where id = any($1::uuid[])`, [[course.lessons.intro, course.lessons.video, course.lessons.quiz]])
  return { repository: createPublicCourseRepository({ query: db.query }), course }
}

describe('public course pages and free previews', () => {
  it('shows the curriculum outline, with only read-or-watch free previews openable', async () => {
    const { repository, course } = await publicCourse()

    const sections = await repository.getPublicCurriculum(course.courseId)

    expect(sections.map((section) => section.title)).toEqual(['Section A', 'Section B'])
    expect(sections.flatMap((section) => section.lessons.map((lesson) => [lesson.title, lesson.preview]))).toEqual([
      ['Intro', true],
      ['Walkthrough video', true],
      ['Knowledge check', false],
      ['Checklist', false],
      ['Inspection report', false],
      ['Wrap-up', false],
    ])
    expect(JSON.stringify(sections)).not.toContain('Welcome to the course.')
  }, 120_000)

  it('opens a free-preview material to anyone, with its content', async () => {
    const { repository, course } = await publicCourse()

    const preview = await repository.getPreviewLesson(course.slug, course.lessons.intro!)

    expect(preview).toMatchObject({
      course: { id: course.courseId, slug: course.slug },
      lesson: { title: 'Intro', lessonType: 'article', articleBody: 'Welcome to the course.', articleFormat: 'plain' },
    })
  }, 120_000)

  it('refuses a material that is not a free preview, or is an activity, or is unpublished or removed', async () => {
    const { repository, course } = await publicCourse()

    expect(await repository.getPreviewLesson(course.slug, course.lessons.checklist!)).toBeNull()
    expect(await repository.getPreviewLesson(course.slug, course.lessons.quiz!)).toBeNull()
    await db.query(`update public.learning_lessons set is_published = false where id = $1`, [course.lessons.video])
    expect(await repository.getPreviewLesson(course.slug, course.lessons.video!)).toBeNull()
    // A real lesson id from another course doesn't open through this course's address.
    const other = await publicCourse()
    expect(await repository.getPreviewLesson(course.slug, other.course.lessons.intro!)).toBeNull()
  }, 120_000)

  it.each(['draft', 'submitted', 'changes_requested', 'archived'])('shows nothing of a %s course publicly', async (status) => {
    const { repository, course } = await publicCourse()
    await db.query(`update public.learning_courses set status = $2 where id = $1`, [course.courseId, status])

    expect(await createMarketplaceRepository({ query: db.query }).getPublishedCourseBySlug(course.slug)).toBeNull()
    expect(await repository.getPublicCurriculum(course.courseId)).toEqual([])
    expect(await repository.getPreviewLesson(course.slug, course.lessons.intro!)).toBeNull()
    expect((await repository.listPublicCourseUrls()).map((entry) => entry.slug)).not.toContain(course.slug)
  }, 120_000)

  it('serves a public course’s cover image to anyone, and nothing else', async () => {
    const { repository, course } = await publicCourse()
    const rows = await db.query(`select thumbnail_path from public.learning_courses where id = $1`, [course.courseId])

    expect(await repository.isPublicCourseThumbnail(rows[0]!.thumbnail_path as string)).toBe(true)
    expect(await repository.isPublicCourseThumbnail('learning/x/y/course_thumbnail/z.png')).toBe(false)
    await db.query(`update public.learning_courses set status = 'draft' where id = $1`, [course.courseId])
    expect(await repository.isPublicCourseThumbnail(rows[0]!.thumbnail_path as string)).toBe(false)
  }, 120_000)

  it('lists discoverable public courses for the sitemap', async () => {
    const { repository, course } = await publicCourse()
    expect((await repository.listPublicCourseUrls()).map((entry) => entry.slug)).toContain(course.slug)
  }, 120_000)
})
