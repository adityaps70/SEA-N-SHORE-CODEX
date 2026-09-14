'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, MessageSquareWarning, XCircle } from 'lucide-react'
import { reviewMentorApplication } from '@/features/learning/admin-actions'
import type { MentorReviewDecision } from '@/features/learning/admin-repository'

export function MentorReviewControls({ applicationId }: { applicationId: string }) {
  const [reviewerNote, setReviewerNote] = useState('')
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit(decision: MentorReviewDecision) {
    setFeedback(null)
    const normalizedNote = reviewerNote.trim()
    if (decision !== 'approved' && !normalizedNote) {
      setFeedback({ tone: 'error', message: 'A reviewer note is required for this decision.' })
      return
    }

    startTransition(async () => {
      const result = await reviewMentorApplication(
        applicationId,
        decision,
        normalizedNote || null,
      )
      if (!result.ok) {
        setFeedback({ tone: 'error', message: result.error })
        return
      }
      const message = decision === 'approved'
        ? 'Mentor approved. The verified mentor workspace is now active.'
        : decision === 'changes_requested'
          ? 'Changes requested. The applicant can update and resubmit.'
          : 'Application rejected. The applicant can review the feedback and resubmit.'
      setFeedback({ tone: 'success', message })
    })
  }

  return (
    <div className="rounded-2xl border border-mist-100 bg-mist-50 p-4">
      <label className="block text-sm font-bold text-navy-950" htmlFor={`review-note-${applicationId}`}>
        Reviewer note
      </label>
      <p className="mt-1 text-xs leading-5 text-muted">
        Required when requesting changes or rejecting. Approval notes are optional.
      </p>
      <textarea
        id={`review-note-${applicationId}`}
        value={reviewerNote}
        onChange={(event) => setReviewerNote(event.target.value)}
        rows={3}
        disabled={isPending}
        className="mt-3 w-full resize-y rounded-xl border border-mist-200 bg-white px-3 py-2 text-sm text-navy-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 disabled:opacity-60"
        placeholder="Add evidence-based feedback for the applicant"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => submit('approved')}
          className="inline-flex items-center gap-2 rounded-xl bg-navy-950 px-3.5 py-2 text-sm font-bold text-white transition hover:bg-navy-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <CheckCircle2 aria-hidden="true" className="size-4" /> Approve mentor
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => submit('changes_requested')}
          className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-sm font-bold text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <MessageSquareWarning aria-hidden="true" className="size-4" /> Request changes
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => submit('rejected')}
          className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-sm font-bold text-red-800 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <XCircle aria-hidden="true" className="size-4" /> Reject application
        </button>
      </div>
      {feedback ? (
        <p
          role="status"
          className={`mt-3 text-sm font-semibold ${feedback.tone === 'success' ? 'text-emerald-700' : 'text-red-700'}`}
        >
          {feedback.message}
        </p>
      ) : null}
    </div>
  )
}
