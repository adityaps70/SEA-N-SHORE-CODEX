'use client'

import { useState, useTransition } from 'react'
import { Archive, CheckCircle2, MessageSquareWarning, Send } from 'lucide-react'
import { reviewCourse } from '@/features/learning/admin-actions'
import type { CourseStatus } from '@/features/learning/course-workflow'
import type { CourseAdminDecision } from '@/features/learning/admin-repository'

export function CourseReviewControls({
  courseId,
  status,
}: {
  courseId: string
  status: CourseStatus
}) {
  const [reviewerNote, setReviewerNote] = useState('')
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit(decision: CourseAdminDecision) {
    setFeedback(null)
    const normalizedNote = reviewerNote.trim()

    if (decision === 'changes_requested' && !normalizedNote) {
      setFeedback({
        tone: 'error',
        message: 'A reviewer note is required when requesting course changes.',
      })
      return
    }

    startTransition(async () => {
      const result = await reviewCourse(courseId, decision, normalizedNote || null)
      if (!result.ok) {
        setFeedback({ tone: 'error', message: result.error })
        return
      }

      const message = decision === 'changes_requested'
        ? 'Changes requested. The trainer or organization manager can revise and resubmit the course.'
        : decision === 'approved'
          ? 'Course approved and published. It is now visible in Learn.'
          : decision === 'published'
            ? 'Course published. It is now eligible for the learning marketplace.'
            : 'Course archived. It has been removed from active marketplace circulation.'

      setFeedback({ tone: 'success', message })
    })
  }

  const actionable = status === 'submitted' || status === 'approved' || status === 'published'

  return (
    <div className="rounded-2xl border border-mist-100 bg-mist-50 p-4">
      {status === 'submitted' ? (
        <>
          <label className="block text-sm font-bold text-navy-950" htmlFor={`course-review-note-${courseId}`}>
            Course reviewer note
          </label>
          <p className="mt-1 text-xs leading-5 text-muted">
            Required when requesting changes. Approval notes are optional.
          </p>
          <textarea
            id={`course-review-note-${courseId}`}
            value={reviewerNote}
            onChange={(event) => setReviewerNote(event.target.value)}
            rows={3}
            disabled={isPending}
            className="mt-3 w-full resize-y rounded-xl border border-mist-200 bg-white px-3 py-2 text-sm text-navy-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 disabled:opacity-60"
            placeholder="Add evidence-based feedback for the course creator"
          />
        </>
      ) : null}

      {actionable ? (
        <div className={status === 'submitted' ? 'mt-3 flex flex-wrap gap-2' : 'flex flex-wrap gap-2'}>
          {status === 'submitted' ? (
            <>
              <button
                type="button"
                disabled={isPending}
                onClick={() => submit('approved')}
                className="inline-flex items-center gap-2 rounded-xl bg-navy-950 px-3.5 py-2 text-sm font-bold text-white transition hover:bg-navy-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <CheckCircle2 aria-hidden="true" className="size-4" /> Approve course
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => submit('changes_requested')}
                className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-sm font-bold text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <MessageSquareWarning aria-hidden="true" className="size-4" /> Request changes
              </button>
            </>
          ) : null}

          {status === 'approved' ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() => submit('published')}
              className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-3.5 py-2 text-sm font-bold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Send aria-hidden="true" className="size-4" /> Publish course
            </button>
          ) : null}

          {status === 'published' ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() => submit('archived')}
              className="inline-flex items-center gap-2 rounded-xl border border-mist-200 bg-white px-3.5 py-2 text-sm font-bold text-navy-950 transition hover:bg-mist-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Archive aria-hidden="true" className="size-4" /> Archive course
            </button>
          ) : null}
        </div>
      ) : null}

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
