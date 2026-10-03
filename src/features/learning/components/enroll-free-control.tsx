'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { enrollInFreeCourse } from '../enrollment-actions'

type Props = {
  courseId: string
  initiallyEnrolled: boolean
}

export function EnrollFreeControl({ courseId, initiallyEnrolled }: Props) {
  const [pending, startTransition] = useTransition()
  const [enrolled, setEnrolled] = useState(initiallyEnrolled)
  const [error, setError] = useState<string | null>(null)

  function onEnroll() {
    setError(null)
    startTransition(async () => {
      const result = await enrollInFreeCourse(courseId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setEnrolled(true)
    })
  }

  if (enrolled) {
    return (
      <div className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50/70 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-emerald-700" />
          <div className="min-w-0">
            <p className="font-bold text-emerald-950">You are enrolled in this course.</p>
            <p className="mt-1 text-sm leading-6 text-emerald-800">
              Your enrollment is saved to your Sea N Shore learning profile.
            </p>
            <Link
              href="/learn/my-learning"
              className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-navy-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900"
            >
              Go to My Learning
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-[1.5rem] border border-teal-100 bg-teal-50/60 p-5 sm:p-6">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Phase 1 access</p>
      <h2 className="mt-1 text-lg font-bold text-navy-950">Enroll free</h2>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
        Join this published course with your existing Sea N Shore account. No separate learning login is required.
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={onEnroll}
        className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-navy-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
        {pending ? 'Enrolling…' : 'Enroll free'}
      </button>

      {error ? (
        <div role="status" className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  )
}
