'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { quizGradingRepository, QuizGradingError } from './quiz-grading-repository'

const gradesSchema = z.array(z.object({
  answerId: z.string().uuid(),
  points: z.number().finite().min(0).max(100),
  feedback: z.string().trim().max(4000).nullable(),
})).min(1).max(200)

type Result = { ok: true; passed: boolean; percentage: number } | { ok: false; error: string }

function message(error: unknown) {
  if (error instanceof QuizGradingError) {
    if (error.message === 'quiz_attempt_not_found') return 'This quiz attempt is not available for grading.'
    if (error.message === 'quiz_attempt_already_graded') return 'This quiz attempt has already been graded.'
    if (error.message === 'quiz_grade_invalid') return 'Give every written answer a score from 0 to its marks (up to two decimal places).'
  }
  return 'We could not save these grades. Please try again.'
}

/** Grades every written answer of a quiz attempt; the attempt's result, completion and certificate follow. */
export async function gradeQuizAttempt(attemptId: string, grades: Array<{ answerId: string; points: number; feedback: string | null }>): Promise<Result> {
  const parsedAttempt = z.string().uuid().safeParse(attemptId)
  const parsedGrades = gradesSchema.safeParse(grades)
  if (!parsedAttempt.success || !parsedGrades.success) return { ok: false, error: 'Invalid grading input.' }
  try {
    const user = await requireAwsUser()
    const result = await quizGradingRepository.grade(user.id, parsedAttempt.data, parsedGrades.data)
    revalidatePath('/learn/studio')
    revalidatePath('/learn/studio/assignments')
    revalidatePath(`/learn/studio/assignments/quiz/${parsedAttempt.data}`)
    revalidatePath('/learn/my-learning')
    return { ok: true, passed: result.passed, percentage: result.percentage }
  } catch (error) {
    return { ok: false, error: message(error) }
  }
}
