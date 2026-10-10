'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Loader2, UserPlus, X } from 'lucide-react'
import { cancelCourseInvitation, enrolLearnerByEmail } from '../course-roster-actions'
import type { RosterEnrolOutcome } from '../course-roster'

function outcomeText(outcome: RosterEnrolOutcome) {
  if (outcome.kind === 'enrolled') return `${outcome.name} is enrolled and has been notified.`
  if (outcome.kind === 'already_enrolled') return `${outcome.name} is already enrolled.`
  if (outcome.kind === 'invited') return 'Invitation sent. They will be enrolled when they sign up with this email address.'
  return 'This email address already has an invitation waiting.'
}

/**
 * Round C (C1): add a learner by email. Members are enrolled now; anyone else is invited.
 * Round D: on a batch course the trainer picks the batch the learner joins.
 */
export function CourseRosterEnrolForm({ courseId, disabledReason, batches, defaultBatchId = null }: {
  courseId: string
  disabledReason: string | null
  batches?: readonly { id: string; title: string; closedLabel: string | null }[]
  defaultBatchId?: string | null
}) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [batchId, setBatchId] = useState(defaultBatchId ?? batches?.find((batch) => !batch.closedLabel)?.id ?? '')
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    startTransition(async () => {
      const result = await enrolLearnerByEmail(courseId, email, batches ? batchId || null : null)
      if (!result.ok) {
        setMessage({ tone: 'error', text: result.error })
        return
      }
      setEmail('')
      setMessage({ tone: 'success', text: outcomeText(result.outcome) })
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} noValidate className="rounded-[1.4rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-base font-bold text-navy-950">Add a learner by email</h2>
      <p className="mt-1 text-sm leading-6 text-muted">
        A Sea N Shore member is enrolled straight away, free of charge. Anyone else gets an invitation and is enrolled when they sign up with that address.
      </p>
      {disabledReason ? (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950">{disabledReason}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {batches ? (
            <label className="w-full text-sm font-semibold text-navy-950">
              Batch
              <select
                value={batchId}
                onChange={(event) => setBatchId(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-mist-200 bg-white px-3 text-sm text-navy-950 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
              >
                <option value="">Choose a batch</option>
                {batches.map((batch) => (
                  <option key={batch.id} value={batch.id} disabled={Boolean(batch.closedLabel)}>
                    {batch.title}{batch.closedLabel ? ` (${batch.closedLabel})` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="min-w-0 flex-1 text-sm font-semibold text-navy-950">
            <span className="sr-only">Email address</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              aria-invalid={message?.tone === 'error'}
              aria-describedby={message ? 'roster-enrol-message' : undefined}
              className="min-h-11 w-full rounded-xl border border-mist-200 bg-white px-3.5 py-2.5 text-sm text-navy-950 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
            />
          </label>
          <button type="submit" disabled={pending || !email.trim() || (Boolean(batches) && !batchId)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-navy-950 px-5 text-sm font-bold text-white hover:bg-navy-900 disabled:cursor-not-allowed disabled:opacity-60">
            {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <UserPlus aria-hidden="true" className="size-4" />}
            Add learner
          </button>
        </div>
      )}
      {message ? (
        <p id="roster-enrol-message" role={message.tone === 'error' ? 'alert' : 'status'} className={`mt-3 text-sm ${message.tone === 'error' ? 'text-rose-700' : 'text-emerald-800'}`}>
          {message.text}
        </p>
      ) : null}
    </form>
  )
}

export function CancelInvitationButton({ courseId, invitationId }: { courseId: string; invitationId: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => {
          setError(null)
          const result = await cancelCourseInvitation(courseId, invitationId)
          if (!result.ok) setError(result.error)
          else router.refresh()
        })}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
      >
        <X aria-hidden="true" className="size-4" /> Cancel
      </button>
      {error ? <span role="alert" className="text-xs text-rose-700">{error}</span> : null}
    </span>
  )
}
