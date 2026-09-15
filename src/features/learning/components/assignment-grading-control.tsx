'use client'

import { useState, useTransition } from 'react'
import { Loader2, Save } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { gradeAssignmentAttempt } from '../assignment-grading-actions'

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

  function submit() {
    const parsed = Number(score)
    setError(null)
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > maxPoints) {
      setError(`Enter a whole-number score from 0 to ${maxPoints}.`)
      return
    }
    startTransition(async () => {
      const result = await gradeAssignmentAttempt(attemptId, parsed, feedback.trim() || null)
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
        <label className="text-sm font-semibold text-navy-950">
          Score / {maxPoints}
          <input
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
        </label>
        <label className="text-sm font-semibold text-navy-950">
          Feedback
          <textarea
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            disabled={pending}
            maxLength={10000}
            className="mt-2 min-h-28 w-full resize-y rounded-xl border border-mist-200 bg-white px-3 py-2.5 text-sm leading-6 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
            placeholder="Give practical feedback the learner can act on…"
          />
        </label>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm font-semibold text-rose-700">{error}</p> : null}
      <button
        type="button"
        onClick={submit}
        disabled={pending || score === ''}
        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
        {pending ? 'Saving grade…' : 'Publish grade'}
      </button>
    </div>
  )
}
