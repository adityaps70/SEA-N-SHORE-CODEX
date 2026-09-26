'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, Loader2, Undo2 } from 'lucide-react'
import { withdrawCourseFromReview } from '../course-actions'

/** Takes an in-review course back to draft so it can be edited. Asks inline before acting. */
export function CourseWithdrawControl({ courseId }: { courseId: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function withdraw() {
    setError(null)
    startTransition(async () => {
      const result = await withdrawCourseFromReview(courseId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setConfirming(false)
      router.refresh()
    })
  }

  return (
    <div className="mt-4">
      {confirming ? (
        <div
          role="group"
          aria-label="Confirm withdrawing from review"
          className="rounded-xl border border-sky-200 bg-white p-4"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !pending) setConfirming(false)
          }}
        >
          <p className="text-sm font-bold text-navy-950">Withdraw this course from review?</p>
          <p className="mt-1 text-sm leading-6 text-muted">
            It goes back to draft so you can edit it. Nothing you submitted is lost. You’ll need to submit it again when you’re ready, and it will rejoin the review queue.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              autoFocus
              disabled={pending}
              onClick={withdraw}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-navy-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-navy-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:opacity-60"
            >
              {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Undo2 aria-hidden="true" className="size-4" />}
              {pending ? 'Withdrawing…' : 'Withdraw and edit'}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirming(false)}
              className="inline-flex min-h-11 items-center rounded-xl border border-mist-200 bg-white px-4 py-2 text-sm font-bold text-navy-950 transition hover:bg-mist-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:opacity-60"
            >
              Keep in review
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null)
            setConfirming(true)
          }}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-sky-300 bg-white px-4 py-2 text-sm font-bold text-sky-900 transition hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
        >
          <Undo2 aria-hidden="true" className="size-4" /> Withdraw from review to edit
        </button>
      )}
      {error ? (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      ) : null}
    </div>
  )
}
