'use server'

import { z } from 'zod'
import { canAccessPlatformAdmin } from '@/features/admin/access'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { createLessonMediaUrl } from '@/lib/aws/storage'
import { coursePaymentRepository } from './course-payment-repository'
import { learnerCourseRepository } from './learner-course-repository'
import { curriculumLessons } from './next-lesson'

const slugSchema = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const lessonIdSchema = z.string().uuid()

export type LessonMediaUrlResult = { ok: true; url: string; expiresAt: string } | { ok: false; error: string }

/**
 * Learning round E (E3): a fresh short-lived URL for the lesson's video or audio, so the player can swap it in
 * before the current one expires (or after a playback error) without losing the learner's place. The same checks
 * as the course player: an enrolled learner with access to an available lesson, or someone still on the course team.
 */
export async function refreshLessonMediaUrl(slug: string, lessonId: string): Promise<LessonMediaUrlResult> {
  const parsedSlug = slugSchema.safeParse(slug)
  const parsedLesson = lessonIdSchema.safeParse(lessonId)
  if (!parsedSlug.success || !parsedLesson.success) return { ok: false, error: 'Invalid course or lesson.' }

  try {
    const user = await requireAwsUser()
    const course = await learnerCourseRepository.getLearnerCourse(user.id, parsedSlug.data)
    if (!course) return { ok: false, error: 'This lesson is not available in your learning enrollment.' }
    if (course.enrollmentSource === 'admin') {
      const stillOnTeam = await coursePaymentRepository.isCourseManager(user.id, course.courseId) || await canAccessPlatformAdmin(user.id)
      if (!stillOnTeam) return { ok: false, error: 'This lesson is not available in your learning enrollment.' }
    }
    const lesson = curriculumLessons(course).find((item) => item.id === parsedLesson.data)
    if (!lesson || !lesson.isAvailable || !lesson.assetPath || !['video', 'audio'].includes(lesson.lessonType)) {
      return { ok: false, error: 'This lesson is not available in your learning enrollment.' }
    }
    const signed = await createLessonMediaUrl(lesson.assetPath)
    return { ok: true, ...signed }
  } catch {
    return { ok: false, error: 'We could not load this material. Please reload the page.' }
  }
}
