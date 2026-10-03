'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { learnerProgressRepository } from './learner-progress-repository'

const slugSchema = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const lessonIdSchema = z.string().uuid()
const playbackPositionSchema = z.number().int().nonnegative()
const playbackDurationSchema = z.number().positive().max(24 * 60 * 60)

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

type SavePlaybackPositionActionResult =
  | {
      ok: true
      lessonId: string
      lastPositionSeconds: number
    }
  | { ok: false; error: string }

function progressError(error: unknown) {
  if (error instanceof Error && error.message === 'lesson_not_accessible') {
    return 'This lesson is not available in your learning enrollment.'
  }
  return 'We could not update your lesson progress. Please try again.'
}

function playbackPositionError(error: unknown) {
  if (error instanceof Error && error.message === 'lesson_not_accessible') {
    return 'This lesson is not available in your learning enrollment.'
  }
  return 'We could not save your playback position. Please try again.'
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

export async function saveLearningPlaybackPosition(
  slug: string,
  lessonId: string,
  positionSeconds: number,
  durationSeconds?: number,
): Promise<SavePlaybackPositionActionResult> {
  const parsedSlug = slugSchema.safeParse(slug)
  const parsedLessonId = lessonIdSchema.safeParse(lessonId)
  const parsedPosition = playbackPositionSchema.safeParse(positionSeconds)
  const parsedDuration = durationSeconds === undefined
    ? { success: true as const, data: undefined }
    : playbackDurationSchema.safeParse(durationSeconds)

  if (!parsedSlug.success || !parsedLessonId.success) {
    return { ok: false, error: 'Invalid course or lesson.' }
  }
  if (!parsedPosition.success || !parsedDuration.success) {
    return { ok: false, error: 'Invalid playback position.' }
  }

  try {
    const user = await requireAwsUser()
    const result = parsedDuration.data === undefined
      ? await learnerProgressRepository.savePlaybackPosition(
          user.id,
          parsedSlug.data,
          parsedLessonId.data,
          parsedPosition.data,
        )
      : await learnerProgressRepository.savePlaybackPosition(
          user.id,
          parsedSlug.data,
          parsedLessonId.data,
          parsedPosition.data,
          parsedDuration.data,
        )

    return {
      ok: true,
      lessonId: result.lessonId,
      lastPositionSeconds: result.lastPositionSeconds,
    }
  } catch (error) {
    return { ok: false, error: playbackPositionError(error) }
  }
}