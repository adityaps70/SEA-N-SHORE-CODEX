'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Hourglass,
  Loader2,
  Play,
  RotateCcw,
  XCircle,
} from 'lucide-react'
import { saveLearningQuizAnswers, startLearningQuiz, submitLearningQuiz } from '../learner-quiz-actions'
import type {
  LearnerQuiz,
  LearnerQuizAttemptResult,
  LearnerQuizAttemptSummary,
  LearnerQuizQuestion,
  LearnerQuizReviewItem,
  LearnerQuizSession,
  LearnerSavedAnswer,
} from '../learner-quiz-repository'
import { hasAnswer, marksLabel, type QuestionType } from '../quiz-model'

type QuizLessonActivityProps = {
  quiz: LearnerQuiz
  slug: string
  lessonId: string
  initiallyCompleted: boolean
  nextLessonHref?: string | null
}

type AnswerState = Record<string, LearnerSavedAnswer>

const AUTOSAVE_DELAY_MS = 1200

function ContinueLink({ nextLessonHref }: { nextLessonHref?: string | null }) {
  if (nextLessonHref) {
    return (
      <Link
        href={nextLessonHref}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
      >
        Continue to next lesson
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    )
  }

  return (
    <Link
      href="/learn/my-learning"
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
    >
      Back to My Learning
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  )
}

/** "Attempts left: 2", or "Unlimited attempts" when the trainer set no limit (stored as blank). */
export function attemptsLeftLabel(maxAttempts: number | null, attemptsUsed: number) {
  if (maxAttempts === null) return 'Unlimited attempts'
  return `Attempts left: ${Math.max(0, maxAttempts - attemptsUsed)}`
}

/** "12:05" or "1:02:05" for a countdown. */
export function countdownLabel(milliseconds: number) {
  const total = Math.max(0, Math.ceil(milliseconds / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

function AttemptLimitNotice({ maxAttempts }: { maxAttempts: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/80 p-4 text-sm leading-6 text-slate-800" role="status">
      <p className="font-semibold text-slate-950">You’ve used all {maxAttempts} {maxAttempts === 1 ? 'attempt' : 'attempts'} for this quiz.</p>
      <p className="mt-1">Your results are saved below. If you think you need another try, contact your trainer.</p>
    </div>
  )
}

function AwaitingGradingNotice() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50/80 p-4 text-sm leading-6 text-sky-950" role="status">
      <Hourglass className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" aria-hidden="true" />
      <div>
        <p className="font-semibold">Awaiting grading</p>
        <p className="mt-0.5">Your trainer grades the written answers. Your result, completion and any certificate follow their grade; we’ll let you know.</p>
      </div>
    </div>
  )
}

function formatAttemptDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value))
}

function AttemptHistory({ history }: { history: LearnerQuizAttemptSummary[] }) {
  if (history.length === 0) return null

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5" aria-label="Quiz attempt history">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Your results</p>
          <h3 className="mt-1 text-base font-semibold text-slate-950">Attempt history</h3>
        </div>
        <p className="text-xs text-slate-500">Times shown in UTC</p>
      </div>
      <div className="mt-4 divide-y divide-slate-100">
        {history.map((attempt) => (
          <div key={attempt.attemptId} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div>
              <p className="text-sm font-semibold text-slate-950">Attempt {attempt.attemptNumber}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {formatAttemptDate(attempt.submittedAt)}
                {attempt.autoSubmitted ? ' · Submitted when time ran out' : ''}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {attempt.awaitingGrading ? null : <span className="text-sm font-semibold text-slate-950">{attempt.percentage}%</span>}
              {attempt.awaitingGrading ? (
                <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800">Awaiting grading</span>
              ) : (
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${attempt.passed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
                  {attempt.passed ? 'Passed' : 'Not passed'}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function summaryOf(result: LearnerQuizAttemptResult): LearnerQuizAttemptSummary {
  return {
    attemptId: result.attemptId,
    attemptNumber: result.attemptNumber,
    submittedAt: result.submittedAt,
    score: result.score,
    totalQuestions: result.totalQuestions,
    percentage: result.percentage,
    passPercentage: result.passPercentage,
    passed: result.passed,
    ...(result.scorePoints !== undefined && result.maxPoints !== undefined ? { scorePoints: result.scorePoints, maxPoints: result.maxPoints } : {}),
    ...(result.awaitingGrading ? { awaitingGrading: true as const } : {}),
    ...(result.autoSubmitted ? { autoSubmitted: true as const } : {}),
  }
}

/** What is sent for one question: only the field its type uses. */
function answerPayload(question: LearnerQuizQuestion, answer: LearnerSavedAnswer | undefined) {
  const type = question.type ?? 'single_choice'
  if (type === 'multiple_choice') return { questionId: question.id, optionIds: answer?.optionIds ?? [] }
  if (type === 'fill_blank' || type === 'subjective') return { questionId: question.id, text: answer?.text ?? '' }
  return { questionId: question.id, optionId: answer?.optionId }
}

function answered(question: LearnerQuizQuestion, answer: LearnerSavedAnswer | undefined) {
  return hasAnswer(question.type ?? 'single_choice', answer ? { questionId: question.id, ...answer } : undefined)
}

const TYPE_HINTS: Partial<Record<QuestionType, string>> = {
  multiple_choice: 'Select every correct answer.',
  fill_blank: 'Type your answer.',
  subjective: 'Your trainer grades this answer.',
}

function QuestionField({
  question,
  index,
  answer,
  disabled,
  onChange,
}: {
  question: LearnerQuizQuestion
  index: number
  answer: LearnerSavedAnswer | undefined
  disabled: boolean
  onChange: (next: LearnerSavedAnswer) => void
}) {
  const type = question.type ?? 'single_choice'
  const marks = question.marks ?? 1
  return (
    <fieldset className="rounded-2xl border border-slate-200 bg-white p-5">
      <legend className="sr-only">Question {index + 1}</legend>
      <div className="flex items-start justify-between gap-3">
        <p className="text-base font-semibold leading-7 text-slate-950">
          <span className="mr-2 text-slate-400">{index + 1}.</span>
          {question.prompt}
        </p>
        {marks !== 1 ? <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{marksLabel(marks)} marks</span> : null}
      </div>
      {TYPE_HINTS[type] ? <p className="mt-1 text-xs font-medium text-slate-500">{TYPE_HINTS[type]}</p> : null}
      {type === 'fill_blank' ? (
        <input
          aria-label={`Answer to question ${index + 1}`}
          type="text"
          maxLength={200}
          value={answer?.text ?? ''}
          disabled={disabled}
          onChange={(event) => onChange({ text: event.target.value })}
          className="mt-4 min-h-11 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-950 outline-none focus:border-slate-950"
        />
      ) : type === 'subjective' ? (
        <textarea
          aria-label={`Answer to question ${index + 1}`}
          maxLength={10000}
          value={answer?.text ?? ''}
          disabled={disabled}
          onChange={(event) => onChange({ text: event.target.value })}
          className="mt-4 min-h-32 w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-sm leading-6 text-slate-950 outline-none focus:border-slate-950"
        />
      ) : (
        <div className="mt-4 space-y-2.5">
          {question.options.map((option) => {
            const checked = type === 'multiple_choice'
              ? Boolean(answer?.optionIds?.includes(option.id))
              : answer?.optionId === option.id
            return (
              <label
                key={option.id}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 text-sm transition ${checked ? 'border-slate-950 bg-slate-50 text-slate-950' : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50/60'}`}
              >
                <input
                  type={type === 'multiple_choice' ? 'checkbox' : 'radio'}
                  name={`quiz-question-${question.id}`}
                  value={option.id}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => {
                    if (type !== 'multiple_choice') {
                      onChange({ optionId: option.id })
                      return
                    }
                    const current = answer?.optionIds ?? []
                    onChange({ optionIds: current.includes(option.id) ? current.filter((id) => id !== option.id) : [...current, option.id] })
                  }}
                  className="mt-0.5 h-4 w-4 border-slate-300 text-slate-950 focus:ring-slate-400"
                />
                <span>{option.label}</span>
              </label>
            )
          })}
        </div>
      )}
    </fieldset>
  )
}

function ReviewDetail({ question, item }: { question: LearnerQuizQuestion; item: LearnerQuizReviewItem }) {
  const labels = (ids: string[]) => ids.map((id) => question.options.find((option) => option.id === id)?.label).filter(Boolean).join('; ')
  return (
    <>
      {item.awaitingGrading ? (
        <p className="mt-2 text-sm font-medium text-sky-800">Awaiting grading</p>
      ) : (
        <p className={`mt-2 text-sm font-medium ${item.isCorrect ? 'text-emerald-700' : 'text-rose-700'}`}>
          {item.isCorrect ? 'Correct' : 'Incorrect'}
          {item.pointsAwarded !== null && (question.marks ?? 1) !== 1 ? ` · ${marksLabel(item.pointsAwarded)} of ${marksLabel(item.maxPoints)} marks` : ''}
        </p>
      )}
      {!item.isCorrect && item.correctOptionIds.length > 0 ? (
        <p className="mt-1 text-sm text-slate-700">{item.correctOptionIds.length > 1 ? 'Correct answers' : 'Correct answer'}: {labels(item.correctOptionIds)}</p>
      ) : null}
      {!item.isCorrect && item.acceptedAnswers.length > 0 ? (
        <p className="mt-1 text-sm text-slate-700">Accepted {item.acceptedAnswers.length > 1 ? 'answers' : 'answer'}: {item.acceptedAnswers.join('; ')}</p>
      ) : null}
      {item.explanation ? <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">{item.explanation}</p> : null}
    </>
  )
}

export function QuizLessonActivity({
  quiz,
  slug,
  lessonId,
  initiallyCompleted,
  nextLessonHref = null,
}: QuizLessonActivityProps) {
  const usesSessions = quiz.usesSessions ?? false
  const [answers, setAnswers] = useState<AnswerState>(quiz.session?.answers ?? {})
  const [session, setSession] = useState<LearnerQuizSession | null>(quiz.session ?? null)
  const [result, setResult] = useState<LearnerQuizAttemptResult | null>(null)
  const [attemptHistory, setAttemptHistory] = useState<LearnerQuizAttemptSummary[]>(quiz.attemptHistory ?? [])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [attemptsUsed, setAttemptsUsed] = useState(quiz.attemptsUsed)
  const [awaitingGrading, setAwaitingGrading] = useState(quiz.awaitingGrading ?? false)
  const [now, setNow] = useState(() => Date.now())
  const submissionKeyRef = useRef<string | null>(null)
  const dirtyRef = useRef(false)
  const autoSubmittedRef = useRef(false)
  // The server's clock minus this device's, so a wrong device clock never changes the deadline.
  const [clockOffset, setClockOffset] = useState(() => (quiz.session ? Date.parse(quiz.session.serverNow) - Date.now() : 0))
  const limitReached = quiz.maxAttempts !== null && attemptsUsed >= quiz.maxAttempts

  const questions = useMemo(() => (usesSessions ? session?.questions ?? [] : quiz.questions), [usesSessions, session, quiz.questions])
  const deadline = session?.deadlineAt ? Date.parse(session.deadlineAt) : null
  const remaining = deadline === null ? null : deadline - (now + clockOffset)

  const allAnswered = questions.length > 0 && questions.every((question) => answered(question, answers[question.id]))
  const answeredCount = questions.filter((question) => answered(question, answers[question.id])).length

  function questionOf(questionId: string) {
    return questions.find((item) => item.id === questionId)
  }

  function correctAnswerLabel(questionId: string, correctOptionId: string | null) {
    return questionOf(questionId)?.options.find((option) => option.id === correctOptionId)?.label ?? 'Correct option'
  }

  function finish(submission: LearnerQuizAttemptResult) {
    submissionKeyRef.current = null
    dirtyRef.current = false
    setAttemptsUsed((current) => Math.max(current, submission.attemptNumber))
    setAttemptHistory((current) => current.some((attempt) => attempt.attemptId === submission.attemptId) ? current : [summaryOf(submission), ...current])
    setAwaitingGrading(Boolean(submission.awaitingGrading))
    setResult(submission)
  }

  async function onSubmit(options: { auto?: boolean } = {}) {
    if (pending || result) return
    if (!usesSessions && !allAnswered) return

    setPending(true)
    setError(null)

    try {
      const payload = questions
        .filter((question) => !usesSessions || answered(question, answers[question.id]))
        .map((question) => answerPayload(question, answers[question.id]))
      const submissionKey = submissionKeyRef.current ?? globalThis.crypto.randomUUID()
      submissionKeyRef.current = submissionKey
      const submission = usesSessions
        ? await submitLearningQuiz(slug, lessonId, payload, submissionKey, session?.id ?? null)
        : await submitLearningQuiz(slug, lessonId, payload, submissionKey)

      if (!submission.ok) {
        if (submission.limitReached && quiz.maxAttempts !== null) setAttemptsUsed(quiz.maxAttempts)
        setError(submission.error)
        return
      }
      finish(submission)
      if (options.auto) setSession(null)
    } catch {
      setError('We could not submit this quiz. Please try again.')
    } finally {
      setPending(false)
    }
  }

  async function onStart() {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const started = await startLearningQuiz(slug, lessonId)
      if (!started.ok) {
        if (started.limitReached && quiz.maxAttempts !== null) setAttemptsUsed(quiz.maxAttempts)
        setError(started.error)
        return
      }
      setClockOffset(Date.parse(started.session.serverNow) - Date.now())
      autoSubmittedRef.current = false
      setNow(Date.now())
      setAnswers(started.session.answers)
      setSession(started.session)
    } catch {
      setError('We could not start this quiz. Please try again.')
    } finally {
      setPending(false)
    }
  }

  function setAnswer(questionId: string, next: LearnerSavedAnswer) {
    dirtyRef.current = true
    setAnswers((current) => ({ ...current, [questionId]: next }))
  }

  // Countdown for timed attempts; at zero the attempt is submitted (the server enforces the same deadline).
  useEffect(() => {
    if (!session?.deadlineAt || result) return
    const timer = setInterval(() => {
      const current = Date.now()
      setNow(current)
      const left = Date.parse(session.deadlineAt!) - (current + clockOffset)
      if (left <= 0 && !autoSubmittedRef.current) {
        autoSubmittedRef.current = true
        void onSubmit({ auto: true })
      }
    }, 1000)
    return () => clearInterval(timer)
    // onSubmit reads the latest answers through state at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.deadlineAt, result, answers, clockOffset])

  // Saves answers to a started attempt shortly after each change.
  useEffect(() => {
    if (!session || result || !dirtyRef.current) return
    const timer = setTimeout(() => {
      dirtyRef.current = false
      setSaveState('saving')
      const payload = questions.filter((question) => answers[question.id]).map((question) => answerPayload(question, answers[question.id]))
      void saveLearningQuizAnswers(slug, lessonId, session.id, payload).then((saved) => {
        if (!saved.ok) {
          dirtyRef.current = true
          setSaveState('error')
          return
        }
        if ('timeUp' in saved) {
          finish(saved)
          setSession(null)
          return
        }
        setSaveState('saved')
      }).catch(() => {
        dirtyRef.current = true
        setSaveState('error')
      })
    }, AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, session?.id, result])

  function onRetry() {
    submissionKeyRef.current = null
    dirtyRef.current = false
    setAnswers({})
    setResult(null)
    setError(null)
    setSaveState('idle')
    if (usesSessions) setSession(null)
  }

  if (initiallyCompleted) {
    return (
      <div className="space-y-4">
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-6" aria-label="Quiz result">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700" aria-hidden="true" />
            <div>
              <h3 className="text-lg font-semibold text-emerald-950">Assessment passed</h3>
              <p className="mt-1 text-sm text-emerald-900">This quiz lesson is already complete.</p>
            </div>
          </div>
          <div className="mt-5">
            <ContinueLink nextLessonHref={nextLessonHref} />
          </div>
        </section>
        <AttemptHistory history={attemptHistory} />
      </div>
    )
  }

  if (result) {
    if (result.awaitingGrading) {
      return (
        <section className="space-y-4 rounded-2xl border border-sky-200 bg-sky-50/50 p-6" aria-label="Quiz result">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-sky-950">Submitted</h3>
            <span className="rounded-full border border-sky-200 bg-white/80 px-2.5 py-1 text-xs font-semibold text-sky-900">Attempt {result.attemptNumber}</span>
          </div>
          {result.lateAnswersIgnored ? <p className="text-sm text-sky-900">Time ran out, so answers sent after the deadline were not counted.</p> : null}
          <AwaitingGradingNotice />
          <AttemptHistory history={attemptHistory} />
        </section>
      )
    }
    const marksShown = result.scorePoints !== undefined && result.maxPoints !== undefined && result.maxPoints !== result.totalQuestions
    return (
      <section
        className={`rounded-2xl border p-6 ${result.passed ? 'border-emerald-200 bg-emerald-50/70' : 'border-amber-200 bg-amber-50/70'}`}
        aria-label="Quiz result"
      >
        <div className="flex items-start gap-3">
          {result.passed ? (
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700" aria-hidden="true" />
          ) : (
            <XCircle className="mt-0.5 h-6 w-6 shrink-0 text-amber-700" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className={`text-lg font-semibold ${result.passed ? 'text-emerald-950' : 'text-amber-950'}`}>
                {result.passed ? 'Assessment passed' : 'Not passed yet'}
              </h3>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${result.passed ? 'border-emerald-200 bg-white/80 text-emerald-800' : 'border-amber-200 bg-white/80 text-amber-900'}`}>
                Attempt {result.attemptNumber}
              </span>
            </div>
            {!result.passed ? <p className="mt-1 text-sm font-medium text-amber-900">Attempt not passed</p> : null}
            {result.autoSubmitted ? <p className="mt-1 text-sm text-slate-700">Time ran out, so your saved answers were submitted.</p> : null}
            <div className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-2">
              <span className={`text-4xl font-bold tracking-tight ${result.passed ? 'text-emerald-950' : 'text-amber-950'}`}>
                {result.percentage}%
              </span>
              <span className={`pb-1 text-sm font-medium ${result.passed ? 'text-emerald-800' : 'text-amber-800'}`}>
                {marksShown
                  ? `${marksLabel(result.scorePoints!)} of ${marksLabel(result.maxPoints!)} marks`
                  : `${result.score} of ${result.totalQuestions} correct`}
              </span>
              <span className={`pb-1 text-sm ${result.passed ? 'text-emerald-800' : 'text-amber-800'}`}>
                Pass mark {result.passPercentage}%
              </span>
            </div>
          </div>
        </div>

        {result.answers.length === 0 && !result.review ? (
          <p className="mt-5 text-sm text-slate-700">Correct answers are not shown for this quiz yet.</p>
        ) : null}
        <div className="mt-6 space-y-3">
          {questions.map((question, index) => {
            const item = result.review?.find((entry) => entry.questionId === question.id)
            const answer = result.answers.find((entry) => entry.questionId === question.id)
            if (!item && !answer) return null
            return (
              <div key={question.id} className="rounded-xl border border-white/80 bg-white/80 p-4">
                <p className="text-sm font-semibold text-slate-950">
                  {index + 1}. {question.prompt}
                </p>
                {item ? <ReviewDetail question={question} item={item} /> : answer ? (
                  <>
                    <p className={`mt-2 text-sm font-medium ${answer.isCorrect ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {answer.isCorrect ? 'Correct' : 'Incorrect'}
                    </p>
                    {!answer.isCorrect ? (
                      <p className="mt-1 text-sm text-slate-700">
                        Correct answer: {correctAnswerLabel(question.id, answer.correctOptionId)}
                      </p>
                    ) : null}
                  </>
                ) : null}
              </div>
            )
          })}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {result.passed ? (
            <ContinueLink nextLessonHref={nextLessonHref} />
          ) : limitReached ? (
            <div className="w-full"><AttemptLimitNotice maxAttempts={quiz.maxAttempts!} /></div>
          ) : (
            <>
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Try again
              </button>
              <span className="text-sm font-medium text-amber-900">{attemptsLeftLabel(quiz.maxAttempts, attemptsUsed)}</span>
            </>
          )}
        </div>
      </section>
    )
  }

  if (limitReached && !session) {
    return (
      <section className="space-y-4" aria-label="Quiz assessment">
        <AttemptLimitNotice maxAttempts={quiz.maxAttempts!} />
        <AttemptHistory history={attemptHistory} />
      </section>
    )
  }

  const header = (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Assessment</p>
          <p className="mt-1 text-sm font-medium text-slate-900">Pass mark {quiz.passPercentage}%</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
            {usesSessions ? quiz.questionCount ?? questions.length : questions.length} {(usesSessions ? quiz.questionCount ?? questions.length : questions.length) === 1 ? 'question' : 'questions'}
          </span>
          {quiz.settings?.timeLimitMinutes ? (
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
              {quiz.settings.timeLimitMinutes} min time limit
            </span>
          ) : null}
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
            {attemptsLeftLabel(quiz.maxAttempts, attemptsUsed)}
          </span>
        </div>
      </div>
      {quiz.instructions ? <p className="mt-3 text-sm leading-6 text-slate-600">{quiz.instructions}</p> : null}
    </div>
  )

  const errorBox = error ? (
    <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900" role="status">
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{error}</span>
    </div>
  ) : null

  if (!usesSessions && awaitingGrading) {
    return (
      <section className="space-y-6" aria-label="Quiz assessment">
        {header}
        <AwaitingGradingNotice />
        <AttemptHistory history={attemptHistory} />
      </section>
    )
  }

  if (usesSessions && !session) {
    return (
      <section className="space-y-6" aria-label="Quiz assessment">
        {header}
        {awaitingGrading ? <AwaitingGradingNotice /> : (
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-base font-semibold text-slate-950">Ready when you are</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
              {quiz.settings?.timeLimitMinutes ? <li>The timer starts when you press Start and keeps running if you leave the page. At the end of the time your saved answers are submitted.</li> : null}
              {quiz.settings?.drawCount ? <li>Each attempt draws its own set of questions.</li> : null}
              <li>Your answers are saved as you go.</li>
              <li>Starting uses one attempt.</li>
            </ul>
            <button
              type="button"
              disabled={pending}
              onClick={() => void onStart()}
              className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
              {pending ? 'Starting…' : 'Start quiz'}
            </button>
          </div>
        )}
        {errorBox}
        <AttemptHistory history={attemptHistory} />
      </section>
    )
  }

  return (
    <section className="space-y-6" aria-label="Quiz assessment">
      {header}

      {session && remaining !== null ? (
        <div
          className={`sticky top-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 text-sm font-semibold shadow-sm ${remaining <= 60_000 ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-slate-200 bg-white text-slate-900'}`}
          role="timer"
          aria-label="Time left"
        >
          <span className="inline-flex items-center gap-2"><Clock3 className="h-4 w-4" aria-hidden="true" /> {countdownLabel(remaining)} left</span>
          <span className="text-xs font-medium text-slate-500">{answeredCount} of {questions.length} answered</span>
        </div>
      ) : null}

      {!session ? <AttemptHistory history={attemptHistory} /> : null}

      <div className="space-y-5">
        {questions.map((question, index) => (
          <QuestionField
            key={question.id}
            question={question}
            index={index}
            answer={answers[question.id]}
            disabled={pending}
            onChange={(next) => setAnswer(question.id, next)}
          />
        ))}
      </div>

      {errorBox}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending || (!usesSessions && !allAnswered)}
          onClick={() => void onSubmit()}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {pending ? 'Submitting…' : 'Submit quiz'}
        </button>
        {session ? (
          <span className="text-xs text-slate-500" aria-live="polite">
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Answers saved' : saveState === 'error' ? 'Not saved yet; retrying with your next answer' : null}
            {usesSessions && !allAnswered ? `${saveState === 'idle' ? '' : ' · '}${questions.length - answeredCount} unanswered` : null}
          </span>
        ) : null}
      </div>
    </section>
  )
}
