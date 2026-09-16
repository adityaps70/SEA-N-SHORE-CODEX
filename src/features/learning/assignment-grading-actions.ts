'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { assignmentGradingRepository } from './assignment-grading-repository'

const attemptSchema = z.string().uuid()
const scoreSchema = z.number().int().min(0).max(100000)
const feedbackSchema = z.string().trim().max(10000).nullable()
const decisionSchema = z.enum(['pass', 'needs_revision'])

type Result =
  | { ok: true; passed: boolean; percentage: number; scorePoints: number; maxPoints: number }
  | { ok: false; error: string }

function message(error: unknown) {
  if (error instanceof Error) {
    if (error.message === 'assignment_attempt_not_found') return 'This submission is not available for grading.'
    if (error.message === 'assignment_already_graded') return 'This submission has already been graded.'
    if (error.message === 'assignment_score_invalid') return 'Enter a score within the assignment maximum.'
    if (error.message === 'assignment_decision_mismatch') return 'The selected decision does not match the score and assignment pass mark.'
  }
  return 'We could not save this grade. Please try again.'
}

export async function gradeAssignmentAttempt(
  attemptId: string,
  scorePoints: number,
  feedback: string | null,
  decision: 'pass' | 'needs_revision',
): Promise<Result> {
  const parsedAttempt = attemptSchema.safeParse(attemptId)
  const parsedScore = scoreSchema.safeParse(scorePoints)
  const parsedFeedback = feedbackSchema.safeParse(feedback)
  const parsedDecision = decisionSchema.safeParse(decision)
  if (!parsedAttempt.success || !parsedScore.success || !parsedFeedback.success || !parsedDecision.success) {
    return { ok: false, error: 'Invalid grading input.' }
  }

  try {
    const user = await requireAwsUser()
    const result = await assignmentGradingRepository.grade(user.id, parsedAttempt.data, {
      scorePoints: parsedScore.data,
      feedback: parsedFeedback.data,
      decision: parsedDecision.data,
    })
    revalidatePath('/learn/studio')
    revalidatePath('/learn/studio/assignments')
    revalidatePath(`/learn/studio/assignments/${parsedAttempt.data}`)
    revalidatePath('/learn/my-learning')
    revalidatePath(`/learn/courses/${result.courseSlug}/learn`)
    return {
      ok: true,
      passed: result.passed,
      percentage: result.percentage,
      scorePoints: result.scorePoints,
      maxPoints: result.maxPoints,
    }
  } catch (error) {
    return { ok: false, error: message(error) }
  }
}
