'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import {
  learnerQuizRepository,
  type LearnerQuizAttemptResult,
  type LearnerQuizSession,
} from './learner-quiz-repository'
import { QUESTION_LIMITS, QUIZ_LIMITS } from './quiz-model'

const slugSchema = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const lessonIdSchema = z.string().uuid()
const submissionKeySchema = z.string().uuid()
const sessionIdSchema = z.string().uuid()
const quizAnswersSchema = z.array(z.object({
  questionId: z.string().uuid(),
  optionId: z.string().uuid().optional(),
  optionIds: z.array(z.string().uuid()).max(QUESTION_LIMITS.options).optional(),
  text: z.string().max(QUESTION_LIMITS.textResponse).optional(),
})).max(QUIZ_LIMITS.questions)

type QuizAnswers = z.infer<typeof quizAnswersSchema>

type SubmitLearningQuizActionResult =
  | ({ ok: true } & LearnerQuizAttemptResult)
  | { ok: false; error: string; limitReached?: boolean }

type SubmissionUuid = `${string}-${string}-${string}-${string}-${string}`

function quizError(error: unknown) {
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
    if (error.message === 'learning_attempt_limit_reached') {
      return 'You have used all your attempts for this quiz, so this answer was not submitted.'
    }
    if (error.message === 'quiz_awaiting_grading') {
      return 'Your last attempt is awaiting grading by your trainer. You can try again once it is graded.'
    }
    if (error.message === 'quiz_session_closed') {
      return 'This attempt has already been submitted. Reload the page to see your result.'
    }
    if (error.message === 'quiz_session_stale') {
      return 'Your trainer updated this quiz while you were answering. Reload the page to start again; this attempt is not counted.'
    }
    if (error.message === 'quiz_time_up') {
      return 'Time is up for this attempt, so these answers were not saved.'
    }
  }
  return 'We could not submit this quiz. Please try again.'
}

function refresh(slug: string) {
  revalidatePath('/learn/my-learning')
  revalidatePath(`/learn/courses/${slug}/learn`)
}

export async function submitLearningQuiz(
  slug: string,
  lessonId: string,
  answers: QuizAnswers,
  submissionKey: string,
  sessionId?: string | null,
): Promise<SubmitLearningQuizActionResult> {
  const parsedSlug = slugSchema.safeParse(slug)
  const parsedLessonId = lessonIdSchema.safeParse(lessonId)
  const parsedAnswers = quizAnswersSchema.safeParse(answers)
  const parsedSubmissionKey = submissionKeySchema.safeParse(submissionKey)
  const parsedSession = sessionId === undefined || sessionId === null ? null : sessionIdSchema.safeParse(sessionId)

  if (
    !parsedSlug.success || !parsedLessonId.success || !parsedAnswers.success || !parsedSubmissionKey.success
    || (parsedSession !== null && !parsedSession.success)
    // A plain quiz is submitted with every answer; a started attempt may be submitted with none (time up).
    || (parsedSession === null && parsedAnswers.data.length === 0)
  ) {
    return { ok: false, error: 'Invalid quiz submission.' }
  }

  try {
    const user = await requireAwsUser()
    const args = [
      user.id,
      parsedSlug.data,
      parsedLessonId.data,
      parsedAnswers.data,
      parsedSubmissionKey.data as SubmissionUuid,
    ] as const
    const result = parsedSession?.success
      ? await learnerQuizRepository.submitQuizAttempt(...args, parsedSession.data)
      : await learnerQuizRepository.submitQuizAttempt(...args)

    refresh(parsedSlug.data)

    return { ok: true, ...result }
  } catch (error) {
    return {
      ok: false,
      error: quizError(error),
      ...(error instanceof Error && error.message === 'learning_attempt_limit_reached' ? { limitReached: true } : {}),
    }
  }
}

/** Starts (or resumes) a timed, shuffled or drawn attempt; the server fixes its questions and deadline. */
export async function startLearningQuiz(
  slug: string,
  lessonId: string,
): Promise<{ ok: true; session: LearnerQuizSession } | { ok: false; error: string; limitReached?: boolean }> {
  const parsedSlug = slugSchema.safeParse(slug)
  const parsedLessonId = lessonIdSchema.safeParse(lessonId)
  if (!parsedSlug.success || !parsedLessonId.success) return { ok: false, error: 'Invalid quiz request.' }
  try {
    const user = await requireAwsUser()
    const session = await learnerQuizRepository.startQuizAttempt(user.id, parsedSlug.data, parsedLessonId.data)
    refresh(parsedSlug.data)
    return { ok: true, session }
  } catch (error) {
    if (error instanceof Error && error.message === 'learning_attempt_limit_reached') {
      return { ok: false, error: 'You have used all your attempts for this quiz.', limitReached: true }
    }
    const message = quizError(error)
    return { ok: false, error: message === 'We could not submit this quiz. Please try again.' ? 'We could not start this quiz. Please try again.' : message }
  }
}

/** Saves answers to a started attempt as the learner goes. After the deadline the server submits instead. */
export async function saveLearningQuizAnswers(
  slug: string,
  lessonId: string,
  sessionId: string,
  answers: QuizAnswers,
): Promise<{ ok: true; savedAt: string } | ({ ok: true; timeUp: true } & LearnerQuizAttemptResult) | { ok: false; error: string }> {
  const parsedSlug = slugSchema.safeParse(slug)
  const parsedLessonId = lessonIdSchema.safeParse(lessonId)
  const parsedSession = sessionIdSchema.safeParse(sessionId)
  const parsedAnswers = quizAnswersSchema.safeParse(answers)
  if (!parsedSlug.success || !parsedLessonId.success || !parsedSession.success || !parsedAnswers.success) {
    return { ok: false, error: 'Invalid quiz answers.' }
  }
  try {
    const user = await requireAwsUser()
    const saved = await learnerQuizRepository.saveQuizAnswers(user.id, parsedSlug.data, parsedLessonId.data, parsedSession.data, parsedAnswers.data)
    if (saved.saved) return { ok: true, savedAt: saved.savedAt }
    refresh(parsedSlug.data)
    return { ok: true, timeUp: true, ...saved.result }
  } catch (error) {
    const message = quizError(error)
    return { ok: false, error: message === 'We could not submit this quiz. Please try again.' ? 'Your answers could not be saved. Check your connection; they are saved again with your next answer.' : message }
  }
}
