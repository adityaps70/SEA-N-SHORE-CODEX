'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { gradeQuizAttempt } from '../quiz-grading-actions'
import { marksLabel } from '../quiz-model'

type PendingAnswer = { id: string; maxPoints: number; number: number; prompt: string; textResponse: string | null }

/** One score (and optional feedback) per written answer, saved together. */
export function QuizGradingControl({ attemptId, answers }: { attemptId: string; answers: PendingAnswer[] }) {
  const [scores, setScores] = useState<Record<string, string>>({})
  const [feedback, setFeedback] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ passed: boolean; percentage: number } | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    const grades = answers.map((answer) => ({ answerId: answer.id, points: Number(scores[answer.id]), feedback: feedback[answer.id]?.trim() || null }))
    const invalid = answers.find((answer) => {
      const value = scores[answer.id]
      const points = Number(value)
      return !value?.trim() || !Number.isFinite(points) || points < 0 || points > answer.maxPoints || Math.round(points * 100) / 100 !== points
    })
    if (invalid) {
      setError(`Question ${invalid.number}: enter a score from 0 to ${marksLabel(invalid.maxPoints)}.`)
      return
    }
    startTransition(async () => {
      const result = await gradeQuizAttempt(attemptId, grades)
      if (!result.ok) setError(result.error)
      else setDone({ passed: result.passed, percentage: result.percentage })
    })
  }

  if (done) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950" role="status">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-700" aria-hidden="true" />
        <p>Grades saved: {done.percentage}% — {done.passed ? 'passed. The material is complete for the learner.' : 'not passed. The learner can try again if attempts remain.'} The learner has been notified.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {answers.map((answer) => (
        <div key={answer.id} className="rounded-2xl border border-mist-200 bg-mist-50 p-4">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-teal-700">Question {answer.number} · {marksLabel(answer.maxPoints)} marks</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-navy-950">{answer.prompt}</p>
          <div className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl border border-mist-100 bg-white p-3 text-sm leading-7 text-navy-900">{answer.textResponse || 'No answer was written.'}</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[140px_1fr]">
            <label className="text-sm font-semibold text-navy-950">
              Score / {marksLabel(answer.maxPoints)}
              <input
                aria-label={`Score for question ${answer.number}`}
                type="number"
                min="0"
                max={answer.maxPoints}
                step="0.25"
                inputMode="decimal"
                value={scores[answer.id] ?? ''}
                onChange={(event) => setScores((current) => ({ ...current, [answer.id]: event.target.value }))}
                className="mt-1.5 min-h-11 w-full rounded-xl border border-mist-200 bg-white px-3 py-2 text-sm text-navy-950 outline-none focus:border-teal-500"
              />
            </label>
            <label className="text-sm font-semibold text-navy-950">
              Feedback <span className="font-normal text-muted">(optional)</span>
              <textarea
                aria-label={`Feedback for question ${answer.number}`}
                maxLength={4000}
                value={feedback[answer.id] ?? ''}
                onChange={(event) => setFeedback((current) => ({ ...current, [answer.id]: event.target.value }))}
                className="mt-1.5 min-h-20 w-full resize-y rounded-xl border border-mist-200 bg-white px-3 py-2 text-sm text-navy-950 outline-none focus:border-teal-500"
              />
            </label>
          </div>
        </div>
      ))}
      {error ? <p className="text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
      <button type="button" disabled={pending} onClick={submit} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-navy-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-900 disabled:opacity-60">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />} Save grades
      </button>
    </div>
  )
}
