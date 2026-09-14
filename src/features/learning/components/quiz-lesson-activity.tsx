'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Loader2,
  RotateCcw,
  XCircle,
} from 'lucide-react'
import { submitLearningQuiz } from '../learner-quiz-actions'
import type { LearnerQuiz, LearnerQuizAttemptResult } from '../learner-quiz-repository'

type QuizLessonActivityProps = {
  quiz: LearnerQuiz
  slug: string
  lessonId: string
  initiallyCompleted: boolean
  nextLessonHref?: string | null
}

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

export function QuizLessonActivity({
  quiz,
  slug,
  lessonId,
  initiallyCompleted,
  nextLessonHref = null,
}: QuizLessonActivityProps) {
  const router = useRouter()
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [result, setResult] = useState<LearnerQuizAttemptResult | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const allAnswered = quiz.questions.length > 0
    && quiz.questions.every((question) => Boolean(selected[question.id]))

  function correctAnswerLabel(questionId: string, correctOptionId: string) {
    const question = quiz.questions.find((item) => item.id === questionId)
    return question?.options.find((option) => option.id === correctOptionId)?.label ?? 'Correct option'
  }

  async function onSubmit() {
    if (pending || result || !allAnswered) return

    setPending(true)
    setError(null)

    try {
      const answers = quiz.questions.map((question) => ({
        questionId: question.id,
        optionId: selected[question.id],
      }))
      const submission = await submitLearningQuiz(slug, lessonId, answers)

      if (!submission.ok) {
        setError(submission.error)
        return
      }

      setResult(submission)
      router.refresh()
    } catch {
      setError('We could not submit this quiz. Please try again.')
    } finally {
      setPending(false)
    }
  }

  function onRetry() {
    setSelected({})
    setResult(null)
    setError(null)
  }

  if (initiallyCompleted) {
    return (
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
    )
  }

  if (result) {
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
            <h3 className={`text-lg font-semibold ${result.passed ? 'text-emerald-950' : 'text-amber-950'}`}>
              {result.passed ? 'Assessment passed' : 'Not passed yet'}
            </h3>
            <div className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-2">
              <span className={`text-4xl font-bold tracking-tight ${result.passed ? 'text-emerald-950' : 'text-amber-950'}`}>
                {result.percentage}%
              </span>
              <span className={`pb-1 text-sm font-medium ${result.passed ? 'text-emerald-800' : 'text-amber-800'}`}>
                {result.score} of {result.totalQuestions} correct
              </span>
              <span className={`pb-1 text-sm ${result.passed ? 'text-emerald-800' : 'text-amber-800'}`}>
                Pass mark {result.passPercentage}%
              </span>
            </div>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {quiz.questions.map((question, index) => {
            const answer = result.answers.find((item) => item.questionId === question.id)
            if (!answer) return null
            return (
              <div key={question.id} className="rounded-xl border border-white/80 bg-white/80 p-4">
                <p className="text-sm font-semibold text-slate-950">
                  {index + 1}. {question.prompt}
                </p>
                <p className={`mt-2 text-sm font-medium ${answer.isCorrect ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {answer.isCorrect ? 'Correct' : 'Incorrect'}
                </p>
                {!answer.isCorrect ? (
                  <p className="mt-1 text-sm text-slate-700">
                    Correct answer: {correctAnswerLabel(question.id, answer.correctOptionId)}
                  </p>
                ) : null}
              </div>
            )
          })}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {result.passed ? (
            <ContinueLink nextLessonHref={nextLessonHref} />
          ) : (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Try again
            </button>
          )}
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-6" aria-label="Quiz assessment">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Assessment</p>
            <p className="mt-1 text-sm font-medium text-slate-900">Pass mark {quiz.passPercentage}%</p>
          </div>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
            {quiz.questions.length} {quiz.questions.length === 1 ? 'question' : 'questions'}
          </span>
        </div>
        {quiz.instructions ? <p className="mt-3 text-sm leading-6 text-slate-600">{quiz.instructions}</p> : null}
      </div>

      <div className="space-y-5">
        {quiz.questions.map((question, index) => (
          <fieldset key={question.id} className="rounded-2xl border border-slate-200 bg-white p-5">
            <legend className="sr-only">Question {index + 1}</legend>
            <p className="text-base font-semibold leading-7 text-slate-950">
              <span className="mr-2 text-slate-400">{index + 1}.</span>
              {question.prompt}
            </p>
            <div className="mt-4 space-y-2.5">
              {question.options.map((option) => {
                const checked = selected[question.id] === option.id
                return (
                  <label
                    key={option.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 text-sm transition ${checked ? 'border-slate-950 bg-slate-50 text-slate-950' : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50/60'}`}
                  >
                    <input
                      type="radio"
                      name={`quiz-question-${question.id}`}
                      value={option.id}
                      checked={checked}
                      disabled={pending}
                      onChange={() => setSelected((current) => ({ ...current, [question.id]: option.id }))}
                      className="mt-0.5 h-4 w-4 border-slate-300 text-slate-950 focus:ring-slate-400"
                    />
                    <span>{option.label}</span>
                  </label>
                )
              })}
            </div>
          </fieldset>
        ))}
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900" role="status">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      <button
        type="button"
        disabled={pending || !allAnswered}
        onClick={() => void onSubmit()}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {pending ? 'Submitting…' : 'Submit quiz'}
      </button>
    </section>
  )
}
