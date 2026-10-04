'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2, Loader2, Send } from 'lucide-react'
import { submitCourseForReview } from '../course-actions'
import { useCourseEditSession } from './course-edit-session'

type Props = {
  courseId: string
  /** True when a reviewer asked for changes and this is a resubmission. */
  resubmission?: boolean
}

type Phase = 'idle' | 'saving' | 'submitting'

export function CourseSubmitControl({ courseId, resubmission = false }: Props) {
  const router = useRouter()
  const session = useCourseEditSession()
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; copy: string } | null>(null)
  const pending = phase !== 'idle'
  const unsaved = session.unsavedLabels
  const actionLabel = resubmission ? 'Resubmit for review' : 'Submit for review'

  async function onSubmit() {
    setMessage(null)

    // Save first: a submission must never go out without the trainer's latest edits.
    if (session.unsavedLabels.length > 0) {
      setPhase('saving')
      const saved = await session.saveAll()
      if (!saved.ok) {
        setPhase('idle')
        setMessage({
          tone: 'error',
          copy: `Not submitted. ${saved.label} could not be saved: ${saved.error}`,
        })
        return
      }
    }

    setPhase('submitting')
    const result = await submitCourseForReview(courseId, session.getDetailsRevision())
    setPhase('idle')
    if (!result.ok) {
      setMessage({ tone: 'error', copy: `Not submitted. ${result.error}` })
      return
    }

    setMessage({
      tone: 'success',
      copy: resubmission
        ? 'Resubmitted for review with your latest changes. The reviewer will see what changed since their last review.'
        : 'Submitted for review with your latest changes. Editing is locked while Sea N Shore reviews the course.',
    })
    // Stay on the page so the result is visible; it re-renders in its "In review" state.
    router.refresh()
  }

  return (
    <section className="rounded-[1.5rem] border border-teal-100 bg-teal-50/60 p-5 sm:p-6" aria-labelledby={`course-submit-${courseId}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Ready for quality review?</p>
          <h2 id={`course-submit-${courseId}`} className="mt-1 text-lg font-bold text-navy-950">
            {resubmission ? 'Resubmit this course to Sea N Shore' : 'Submit this course to Sea N Shore'}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
            Any unsaved changes on this page are saved first, then the course is sent for review. While it is in review, editing is locked; you can withdraw it from review if you need to change something.
          </p>
          {unsaved.length > 0 ? (
            <p className="mt-2 text-sm font-semibold text-amber-900">
              Will be saved first: {unsaved.join(', ')}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => void onSubmit()}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-navy-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Send aria-hidden="true" className="size-4" />}
          {phase === 'saving' ? 'Saving changes…' : phase === 'submitting' ? 'Submitting…' : actionLabel}
        </button>
      </div>

      {message ? (
        <div role={message.tone === 'error' ? 'alert' : 'status'} className={`mt-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${message.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-rose-200 bg-rose-50 text-rose-900'}`}>
          {message.tone === 'success' ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
          <span>{message.copy}</span>
        </div>
      ) : null}
    </section>
  )
}
