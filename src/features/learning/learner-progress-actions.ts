'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { learnerProgressRepository } from './learner-progress-repository'

const slugSchema = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const lessonIdSchema = z.string().uuid()

type CompleteLessonActionResult =
  | {
      ok: true
      lessonId: string
      completedLessons: number
      totalLessons: number
      progressPercent: number
      enrollmentCompleted: boolean
    }
  | { ok: false; error: string }

function progressError(error: unknown) {
  if (error instanceof Error && error.message === 'lesson_not_accessible') {
    return 'This lesson is not available in your learning enrollment.'
  }
  return 'We could not update your lesson progress. Please try again.'
}

export async function completeLearningLesson(
  slug: string,
  lessonId: string,
): Promise<CompleteLessonActionResult> {
  const parsedSlug = slugSchema.safeParse(slug)
  const parsedLessonId = lessonIdSchema.safeParse(lessonId)
  if (!parsedSlug.success || !parsedLessonId.success) {
    return { ok: false, error: 'Invalid course or lesson.' }
  }

  try {
    const user = await requireAwsUser()
    const result = await learnerProgressRepository.completeLesson(
      user.id,
      parsedSlug.data,
      parsedLessonId.data,
    )

    revalidatePath('/learn/my-learning')
    revalidatePath(`/learn/courses/${parsedSlug.data}/learn`)

    return {
      ok: true,
      lessonId: result.lessonId,
      completedLessons: result.completedLessons,
      totalLessons: result.totalLessons,
      progressPercent: result.progressPercent,
      enrollmentCompleted: result.enrollmentCompleted,
    }
  } catch (error) {
    return { ok: false, error: progressError(error) }
  }
}
