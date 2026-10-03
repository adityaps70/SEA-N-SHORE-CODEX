'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { scormRepository } from './scorm-repository'

const slugSchema = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const uuidSchema = z.string().uuid()
const valuesSchema = z.record(z.string().max(128), z.string().max(200000)).refine((value) => Object.keys(value).length <= 128)

type StartResult =
  | { ok: true; attemptId: string; attemptNumber: number; scormVersion: '1.2' | '2004' }
  | { ok: false; error: string }
type CommitResult =
  | { ok: true; completed: boolean }
  | { ok: false; error: string }

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.message === 'scorm_not_accessible') return 'This SCORM material is not available yet.'
    if (error.message === 'learning_attempt_limit_reached') return 'You have used all attempts allowed for this material.'
    if (error.message === 'scorm_attempt_not_found') return 'This SCORM attempt is no longer available.'
  }
  return 'We could not update the SCORM session. Please try again.'
}

export async function startLearningScormAttempt(slug: string, lessonId: string): Promise<StartResult> {
  const parsedSlug = slugSchema.safeParse(slug)
  const parsedLesson = uuidSchema.safeParse(lessonId)
  if (!parsedSlug.success || !parsedLesson.success) return { ok: false, error: 'Invalid SCORM material.' }
  try {
    const user = await requireAwsUser()
    const attempt = await scormRepository.startAttempt(user.id, parsedSlug.data, parsedLesson.data)
    return {
      ok: true,
      attemptId: attempt.id,
      attemptNumber: attempt.attemptNumber,
      scormVersion: attempt.scormVersion,
    }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

export async function commitLearningScormAttempt(
  slug: string,
  attemptId: string,
  values: Record<string, string>,
): Promise<CommitResult> {
  const parsedSlug = slugSchema.safeParse(slug)
  const parsedAttempt = uuidSchema.safeParse(attemptId)
  const parsedValues = valuesSchema.safeParse(values)
  if (!parsedSlug.success || !parsedAttempt.success || !parsedValues.success) {
    return { ok: false, error: 'Invalid SCORM runtime update.' }
  }
  try {
    const user = await requireAwsUser()
    const result = await scormRepository.commit(user.id, parsedAttempt.data, parsedValues.data)
    if (result.completed) {
      revalidatePath('/learn/my-learning')
      revalidatePath(`/learn/courses/${parsedSlug.data}/learn`)
    }
    return { ok: true, completed: result.completed }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}
