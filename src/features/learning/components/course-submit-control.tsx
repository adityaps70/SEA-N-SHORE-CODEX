'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2, Loader2, Send } from 'lucide-react'
import { submitCourseForReview } from '../course-actions'

type Props = {
  courseId: string
}

export function CourseSubmitControl({ courseId }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; copy: string } | null>(null)

  function onSubmit() {
    setMessage(null)
    startTransition(async () => {
      const result = await submitCourseForReview(courseId)
      if (!result.ok) {
        setMessage({ tone: 'error', copy: result.error })
        return
      }

      setMessage({ tone: 'success', copy: 'Course submitted for Sea N Shore review.' })
      router.push('/learn/studio')
    })
  }

  return (
    <section className="rounded-[1.5rem] border border-teal-100 bg-teal-50/60 p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Ready for quality review?</p>
          <h2 className="mt-1 text-lg font-bold text-navy-950">Submit this course to Sea N Shore</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
            Save your latest changes before submitting. Once submitted, editing is locked while the Sea N Shore learning team reviews the course.
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={onSubmit}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-navy-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Send aria-hidden="true" className="size-4" />}
          {pending ? 'Submitting…' : 'Submit for review'}
        </button>
      </div>

      {message ? (
        <div role="status" className={`mt-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${message.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-rose-200 bg-rose-50 text-rose-900'}`}>
          {message.tone === 'success' ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
          <span>{message.copy}</span>
        </div>
      ) : null}
    </section>
  )
}
