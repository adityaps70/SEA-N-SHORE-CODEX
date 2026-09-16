'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, Loader2, RotateCcw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { gradeAssignmentAttempt } from '../assignment-grading-actions'

type GradeDecision = 'pass' | 'needs_revision'

export function AssignmentGradingControl({ attemptId, maxPoints, passingPercentage }: {
  attemptId: string
  maxPoints: number
  passingPercentage: number
}) {
  const router = useRouter()
  const [score, setScore] = useState('')
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit(decision: GradeDecision) {
    const parsed = Number(score)
    const trimmedFeedback = feedback.trim()
    setError(null)
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > maxPoints) {
      setError(`Enter a whole-number score from 0 to ${maxPoints}.`)
      return
    }

    const percentage = Math.round((parsed / maxPoints) * 100)
    if (decision === 'pass' && percentage < passingPercentage) {
      setError(`Pass requires a score meeting the ${passingPercentage}% pass mark.`)
      return
    }
    if (decision === 'needs_revision' && percentage >= passingPercentage) {
      setError(`Needs revision requires a score below the ${passingPercentage}% pass mark.`)
      return
    }
    if (decision === 'needs_revision' && trimmedFeedback.length === 0) {
      setError('Feedback is required when requesting revision.')
      return
    }

    startTransition(async () => {
      const result = await gradeAssignmentAttempt(
        attemptId,
        parsed,
        trimmedFeedback || null,
        decision,
      )
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="mt-5 rounded-2xl border border-mist-200 bg-mist-50 p-4">
      <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
        <div>
          <label htmlFor={`assignment-score-${attemptId}`} className="text-sm font-semibold text-navy-950">
            Score / {maxPoints}
          </label>
          <input
            id={`assignment-score-${attemptId}`}
            type="number"
            min={0}
            max={maxPoints}
            step={1}
            value={score}
            onChange={(event) => setScore(event.target.value)}
            disabled={pending}
            className="mt-2 w-full rounded-xl border border-mist-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
          />
          <span className="mt-1 block text-xs font-normal text-muted">Pass mark {passingPercentage}%</span>
        </div>
        <div>
          <label htmlFor={`assignment-feedback-${attemptId}`} className="text-sm font-semibold text-navy-950">
            Feedback
          </label>
          <textarea
            id={`assignment-feedback-${attemptId}`}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            disabled={pending}
            maxLength={10000}
            className="mt-2 min-h-28 w-full resize-y rounded-xl border border-mist-200 bg-white px-3 py-2.5 text-sm leading-6 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
            placeholder="Give practical feedback the learner can act on…"
          />
        </div>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm font-semibold text-rose-700">{error}</p> : null}
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => submit('pass')}
          disabled={pending || score === ''}
          className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />}
          Pass
        </button>
        <button
          type="button"
          onClick={() => submit('needs_revision')}
          disabled={pending || score === ''}
          className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-bold text-amber-900 disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-4" aria-hidden="true" />}
          Needs revision
        </button>
      </div>
    </div>
  )
}
