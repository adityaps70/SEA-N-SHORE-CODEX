'use client'

import { useEffect, useState, useTransition } from 'react'
import { CheckCircle2, Clock3, Loader2, RotateCcw, Send, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { getLearningAssignmentState, submitLearningAssignment } from '../learner-assignment-actions'
import type { LearnerAssignmentState } from '../learner-assignment-repository'

type Props = {
  slug: string
  lessonId: string
  instructions: string
  acceptedExtensions: string[]
  maxUploadBytes: number
  maxAttempts: number | null
  attemptsUsed: number
  initiallyCompleted: boolean
}

export function AssignmentActivity({
  slug,
  lessonId,
  instructions,
  acceptedExtensions,
  maxUploadBytes,
  maxAttempts,
  attemptsUsed,
  initiallyCompleted,
}: Props) {
  const router = useRouter()
  const [response, setResponse] = useState('')
  const [state, setState] = useState<LearnerAssignmentState | null>(null)
  const [loadingState, setLoadingState] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function refreshState() {
    const result = await getLearningAssignmentState(slug, lessonId)
    if (result.ok) setState(result.state)
    else setError(result.error)
    setLoadingState(false)
  }

  useEffect(() => {
    void refreshState()
    // Server action identity is stable for this mounted material; slug/lessonId are the state key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, lessonId])

  const attemptsRemaining = state?.attemptsRemaining
    ?? (maxAttempts === null ? null : Math.max(0, maxAttempts - attemptsUsed))
  const completed = state?.completed ?? initiallyCompleted
  const reviewPending = state?.reviewPending ?? false
  const latest = state?.latestAttempt ?? null
  const exhausted = !completed && !reviewPending && attemptsRemaining === 0

  function submit() {
    setError(null)
    startTransition(async () => {
      const result = await submitLearningAssignment(slug, lessonId, response)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setResponse('')
      await refreshState()
      router.refresh()
    })
  }

  return (
    <section className="rounded-2xl border border-mist-200 bg-white p-5">
      <p className="text-sm font-bold text-navy-950">Assignment</p>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-navy-800">{instructions}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
        {attemptsRemaining !== null ? <span>{attemptsRemaining} attempt{attemptsRemaining === 1 ? '' : 's'} remaining</span> : <span>Unlimited attempts</span>}
        {acceptedExtensions.length > 0 ? <span>· File rules: {acceptedExtensions.join(', ')}</span> : null}
        <span>· Configured upload limit {Math.max(1, Math.round(maxUploadBytes / (1024 * 1024)))} MB</span>
      </div>
      <p className="mt-2 text-xs text-muted">This grading slice accepts written responses. File attachment upload will use the already-configured assignment media rules in a later media slice.</p>

      {loadingState && !completed ? (
        <div className="mt-5 flex items-center gap-2 text-sm font-semibold text-muted"><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading submission status…</div>
      ) : completed ? (
        <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <div className="flex items-center gap-2 font-bold"><CheckCircle2 className="size-4" aria-hidden="true" /> Assignment passed and material completed.</div>
          {latest?.percentage !== null && latest?.percentage !== undefined ? <p className="mt-2">Score: {latest.scorePoints}/{state?.maxPoints} · {latest.percentage}%</p> : null}
          {latest?.feedback ? <p className="mt-2 leading-6"><span className="font-bold">Mentor feedback:</span> {latest.feedback}</p> : null}
        </div>
      ) : reviewPending ? (
        <div className="mt-5 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <div className="flex items-center gap-2 font-bold"><Clock3 className="size-4" aria-hidden="true" /> Awaiting mentor review</div>
          <p className="mt-2">Attempt {latest?.attemptNumber ?? attemptsUsed + 1} has been submitted. Progress unlocks only after a passing grade.</p>
        </div>
      ) : (
        <>
          {latest?.status === 'graded' && latest.passed === false ? (
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <div className="flex items-center gap-2 font-bold"><XCircle className="size-4" aria-hidden="true" /> Revision required</div>
              <p className="mt-2">Score: {latest.scorePoints}/{state?.maxPoints} · {latest.percentage}% · Pass mark {state?.passingPercentage}%</p>
              {latest.feedback ? <p className="mt-2 leading-6"><span className="font-bold">Mentor feedback:</span> {latest.feedback}</p> : null}
            </div>
          ) : null}
          <label className="mt-5 block text-sm font-semibold text-navy-950">
            {latest?.passed === false ? 'Revised response' : 'Your response'}
            <textarea
              value={response}
              onChange={(event) => setResponse(event.target.value)}
              disabled={pending || exhausted}
              className="mt-2 min-h-40 w-full resize-y rounded-xl border border-mist-200 bg-white px-4 py-3 text-sm leading-6 text-navy-950 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:bg-mist-50"
              placeholder="Write your response here…"
            />
          </label>
          <button
            type="button"
            disabled={pending || exhausted || response.trim().length === 0}
            onClick={submit}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : latest?.passed === false ? <RotateCcw className="size-4" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
            {exhausted ? 'Attempt limit reached' : pending ? 'Submitting…' : latest?.passed === false ? 'Submit revision' : 'Submit for review'}
          </button>
        </>
      )}

      {state && state.attempts.length > 1 ? (
        <div className="mt-5 border-t border-mist-100 pt-4">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Attempt history</p>
          <div className="mt-2 space-y-2">
            {state.attempts.map((attempt) => (
              <div key={attempt.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                <span>Attempt {attempt.attemptNumber}</span>
                <span>{attempt.status === 'submitted' ? 'Awaiting review' : attempt.passed ? `Passed · ${attempt.percentage}%` : `Not passed · ${attempt.percentage}%`}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-3 text-sm font-semibold text-rose-700">{error}</p> : null}
    </section>
  )
}
