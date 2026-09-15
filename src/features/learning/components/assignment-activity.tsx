'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, Loader2, Send } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { submitLearningAssignment } from '../learner-assignment-actions'

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
  const [completed, setCompleted] = useState(initiallyCompleted)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const attemptsRemaining = maxAttempts === null ? null : Math.max(0, maxAttempts - attemptsUsed)
  const exhausted = !completed && attemptsRemaining === 0

  function submit() {
    setError(null)
    startTransition(async () => {
      const result = await submitLearningAssignment(slug, lessonId, response)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setCompleted(true)
      router.refresh()
    })
  }

  return (
    <section className="rounded-2xl border border-mist-200 bg-white p-5">
      <p className="text-sm font-bold text-navy-950">Assignment</p>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-navy-800">{instructions}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
        {attemptsRemaining !== null ? <span>{attemptsRemaining} attempt{attemptsRemaining === 1 ? '' : 's'} remaining</span> : <span>Unlimited attempts</span>}
        {acceptedExtensions.length > 0 ? <span>· Attachments supported by the assignment: {acceptedExtensions.join(', ')}</span> : null}
        <span>· Limit {Math.max(1, Math.round(maxUploadBytes / (1024 * 1024)))} MB</span>
      </div>

      {completed ? (
        <div className="mt-5 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
          <CheckCircle2 className="size-4" aria-hidden="true" /> Assignment submitted and material completed.
        </div>
      ) : (
        <>
          <label className="mt-5 block text-sm font-semibold text-navy-950">
            Your response
            <textarea
              value={response}
              onChange={(event) => setResponse(event.target.value)}
              disabled={pending || exhausted}
              className="mt-2 min-h-40 w-full resize-y rounded-xl border border-mist-200 bg-white px-4 py-3 text-sm leading-6 text-navy-950 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:bg-mist-50"
              placeholder="Write your response here…"
            />
          </label>
          <p className="mt-2 text-xs text-muted">Phase 1 records the written assignment response natively. Mentor-configured attachment rules are shown above and the submission model is ready for attachment storage.</p>
          <button
            type="button"
            disabled={pending || exhausted || response.trim().length === 0}
            onClick={submit}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
            {exhausted ? 'Attempt limit reached' : 'Submit assignment'}
          </button>
        </>
      )}
      {error ? <p role="alert" className="mt-3 text-sm font-semibold text-rose-700">{error}</p> : null}
    </section>
  )
}
