'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { learnerAssignmentRepository, type LearnerAssignmentState } from './learner-assignment-repository'

const slugSchema = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const uuidSchema = z.string().uuid()
const responseSchema = z.string().trim().min(1, 'Write a response before submitting.').max(50000)

type SubmitResult =
  | { ok: true; attemptId: string; attemptNumber: number; status: 'submitted'; submittedAt: string; completed: false }
  | { ok: false; error: string }

type StateResult =
  | { ok: true; state: LearnerAssignmentState }
  | { ok: false; error: string }

function message(error: unknown) {
  if (error instanceof Error) {
    if (error.message === 'assignment_not_accessible') return 'This assignment is not available yet.'
    if (error.message === 'assignment_already_completed') return 'This assignment is already complete.'
    if (error.message === 'assignment_review_pending') return 'Your latest submission is awaiting mentor review.'
    if (error.message === 'learning_attempt_limit_reached') return 'You have used all attempts allowed for this assignment.'
    if (error.message === 'assignment_submission_empty') return 'Write a response before submitting.'
  }
  return 'We could not submit this assignment. Please try again.'
}

export async function getLearningAssignmentState(slug: string, lessonId: string): Promise<StateResult> {
  const parsedSlug = slugSchema.safeParse(slug)
  const parsedLesson = uuidSchema.safeParse(lessonId)
  if (!parsedSlug.success || !parsedLesson.success) return { ok: false, error: 'Invalid assignment.' }

  try {
    const user = await requireAwsUser()
    const state = await learnerAssignmentRepository.getState(user.id, parsedSlug.data, parsedLesson.data)
    if (!state) return { ok: false, error: 'This assignment is not available.' }
    return { ok: true, state }
  } catch {
    return { ok: false, error: 'We could not load this assignment result.' }
  }
}

export async function submitLearningAssignment(
  slug: string,
  lessonId: string,
  responseText: string,
): Promise<SubmitResult> {
  const parsedSlug = slugSchema.safeParse(slug)
  const parsedLesson = uuidSchema.safeParse(lessonId)
  const parsedResponse = responseSchema.safeParse(responseText)
  if (!parsedSlug.success || !parsedLesson.success) return { ok: false, error: 'Invalid assignment.' }
  if (!parsedResponse.success) return { ok: false, error: parsedResponse.error.issues[0]?.message ?? 'Invalid assignment response.' }

  try {
    const user = await requireAwsUser()
    const result = await learnerAssignmentRepository.submit(user.id, parsedSlug.data, parsedLesson.data, {
      responseText: parsedResponse.data,
      attachmentPath: null,
    })
    revalidatePath('/learn/my-learning')
    revalidatePath(`/learn/courses/${parsedSlug.data}/learn`)
    return { ok: true, ...result }
  } catch (error) {
    return { ok: false, error: message(error) }
  }
}
