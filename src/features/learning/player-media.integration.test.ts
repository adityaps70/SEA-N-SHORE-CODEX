import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createCaptionRepository } from './caption-repository'
import { createLearnerProgressRepository } from './learner-progress-repository'
import { createActiveMentor, createProfile, createPublishedCourse, enrollLearner } from './learning-test-fixtures'

/**
 * Course player media (learning round A, A7) against the real schema (PGlite): video completion
 * counts real viewing, checked against the clock, and captions are readable only by the course's
 * learners (or anyone, for a free preview).
 */

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

async function progress(enrollmentId: string, lessonId: string) {
  const rows = await db.query(
    `select completed, media_percent, watched_seconds, furthest_position_seconds, last_position_seconds
     from public.learning_progress where enrollment_id = $1 and lesson_id = $2`,
    [enrollmentId, lessonId],
  )
  return rows[0]
}

async function backdate(enrollmentId: string, lessonId: string, seconds: number) {
  await db.query(
    `update public.learning_progress set updated_at = now() - make_interval(secs => $3) where enrollment_id = $1 and lesson_id = $2`,
    [enrollmentId, lessonId, seconds],
  )
}

describe('course player media', () => {
  it('never completes a video from a forged jump to the end', async () => {
    const trainer = await createActiveMentor(db.query)
    const course = await createPublishedCourse(db.query, trainer)
    const { enrollmentId, learnerId } = await enrollLearner(db.query, course.courseId, 'Learner K')
    const repository = createLearnerProgressRepository({ transaction: db.transaction })
    const video = course.lessons.video!

    await repository.savePlaybackPosition(learnerId, course.slug, video, 15, 600, 15)
    await backdate(enrollmentId, video, 5)
    await repository.savePlaybackPosition(learnerId, course.slug, video, 598, 600, 598)

    const row = await progress(enrollmentId, video)
    expect(row).toMatchObject({ completed: false })
    expect(Number(row!.furthest_position_seconds)).toBeLessThan(60)
    expect(Number(row!.last_position_seconds)).toBeLessThan(60)
    expect(Number(row!.media_percent)).toBeLessThan(10)
  }, 120_000)

  it('completes a video watched through, and keeps a rewatch from lowering progress', async () => {
    const trainer = await createActiveMentor(db.query)
    const course = await createPublishedCourse(db.query, trainer)
    const { enrollmentId, learnerId } = await enrollLearner(db.query, course.courseId, 'Learner L')
    const repository = createLearnerProgressRepository({ transaction: db.transaction })
    const video = course.lessons.video!

    for (let position = 15; position <= 555; position += 15) {
      await repository.savePlaybackPosition(learnerId, course.slug, video, position, 600, position)
      await backdate(enrollmentId, video, 15)
    }
    const watched = await progress(enrollmentId, video)
    expect(watched).toMatchObject({ completed: true })
    expect(Number(watched!.media_percent)).toBeGreaterThanOrEqual(90)

    // Rewatching from the start moves the resume point back and nothing else.
    await repository.savePlaybackPosition(learnerId, course.slug, video, 20, 600, 575)
    const rewatch = await progress(enrollmentId, video)
    expect(rewatch).toMatchObject({ completed: true })
    expect(Number(rewatch!.last_position_seconds)).toBe(555)
    expect(Number(rewatch!.media_percent)).toBe(Number(watched!.media_percent))
  }, 120_000)

  it('serves captions to the course’s learners, to anyone for a free preview, and to no one else', async () => {
    const trainer = await createActiveMentor(db.query)
    const course = await createPublishedCourse(db.query, trainer)
    const video = course.lessons.video!
    await db.query(`update public.learning_lessons set caption_path = 'learning/fixture/captions.vtt' where id = $1`, [video])
    const { learnerId } = await enrollLearner(db.query, course.courseId, 'Learner M')
    const outsider = await createProfile(db.query, 'Visitor N')
    const captions = createCaptionRepository({ query: db.query })

    expect(await captions.captionPathForViewer(video, learnerId)).toBe('learning/fixture/captions.vtt')
    expect(await captions.captionPathForViewer(video, outsider)).toBeNull()
    expect(await captions.captionPathForViewer(video, null)).toBeNull()

    await db.query(`update public.learning_lessons set is_preview = true where id = $1`, [video])
    expect(await captions.captionPathForViewer(video, null)).toBe('learning/fixture/captions.vtt')

    // A drip video not yet released to the learner keeps its captions private too.
    await db.query(`update public.learning_lessons set is_preview = false, release_mode = 'drip', drip_delay_days = 7 where id = $1`, [video])
    expect(await captions.captionPathForViewer(video, learnerId)).toBeNull()
  }, 120_000)
})
