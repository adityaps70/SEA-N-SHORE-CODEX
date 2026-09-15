'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import {
  learnerQuizRepository,
  type LearnerQuizAttemptResult,
} from './learner-quiz-repository'

const slugSchema = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const lessonIdSchema = z.string().uuid()
const submissionKeySchema = z.string().uuid()
const quizAnswersSchema = z.array(z.object({
  questionId: z.string().uuid(),
  optionId: z.string().uuid(),
})).min(1).max(100)

type SubmitLearningQuizActionResult =
  | ({ ok: true } & LearnerQuizAttemptResult)
  | { ok: false; error: string }

function quizSubmissionError(error: unknown) {
  if (error instanceof Error) {
    if (error.message === 'quiz_not_accessible') {
      return 'This quiz is not available in your learning enrollment.'
    }
    if (error.message === 'quiz_answers_invalid') {
      return 'Please answer every quiz question with a valid option.'
    }
    if (error.message === 'quiz_not_ready') {
      return 'This quiz is not ready for assessment yet.'
    }
  }
  return 'We could not submit this quiz. Please try again.'
}

export async function submitLearningQuiz(
  slug: string,
  lessonId: string,
  answers: Array<{ questionId: string; optionId: string }>,
  submissionKey: string,
): Promise<SubmitLearningQuizActionResult> {
  const parsedSlug = slugSchema.safeParse(slug)
  const parsedLessonId = lessonIdSchema.safeParse(lessonId)
  const parsedAnswers = quizAnswersSchema.safeParse(answers)
  const parsedSubmissionKey = submissionKeySchema.safeParse(submissionKey)

  if (!parsedSlug.success || !parsedLessonId.success || !parsedAnswers.success || !parsedSubmissionKey.success) {
    return { ok: false, error: 'Invalid quiz submission.' }
  }

  try {
    const user = await requireAwsUser()
    const result = await learnerQuizRepository.submitQuizAttempt(
      user.id,
      parsedSlug.data,
      parsedLessonId.data,
      parsedAnswers.data,
      parsedSubmissionKey.data,
    )

    revalidatePath('/learn/my-learning')
    revalidatePath(`/learn/courses/${parsedSlug.data}/learn`)

    return { ok: true, ...result }
  } catch (error) {
    return { ok: false, error: quizSubmissionError(error) }
  }
}
