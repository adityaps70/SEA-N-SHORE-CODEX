'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, FilePenLine, Loader2, Trash2 } from 'lucide-react'
import { discardCourseRevision, startCourseRevision } from '../course-actions'
import type { CourseOpenRevision } from '../course-repository'

const primaryButton = 'inline-flex min-h-11 items-center gap-2 rounded-xl bg-navy-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-navy-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:opacity-60'
const secondaryButton = 'inline-flex min-h-11 items-center gap-2 rounded-xl border border-mist-200 bg-white px-4 py-2 text-sm font-bold text-navy-950 transition hover:bg-mist-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:opacity-60'

function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
      <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> {error}
    </p>
  )
}

/**
 * On a published course: opens its draft copy (creating it the first time). If a draft copy is
 * already open, links to it instead.
 */
export function CourseRevisionStartControl({ courseId, openRevision }: { courseId: string; openRevision: CourseOpenRevision | null }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (openRevision) {
    const inReview = openRevision.status === 'submitted'
    return (
      <div className="mt-4">
        <Link href={`/learn/studio/courses/${openRevision.courseId}/edit`} className={primaryButton}>
          <FilePenLine aria-hidden="true" className="size-4" />
          {inReview ? 'View your changes in review' : 'Continue editing your changes'}
        </Link>
      </div>
    )
  }

  function start() {
    setError(null)
    startTransition(async () => {
      const result = await startCourseRevision(courseId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.push(`/learn/studio/courses/${result.revisionCourseId}/edit`)
    })
  }

  return (
    <div className="mt-4">
      <button type="button" disabled={pending} onClick={start} className={primaryButton}>
        {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <FilePenLine aria-hidden="true" className="size-4" />}
        {pending ? 'Opening a draft copy…' : 'Edit course'}
      </button>
      <ErrorNote error={error} />
    </div>
  )
}

/** On a draft copy of a published course: throws the changes away. Asks inline before acting. */
export function CourseRevisionDiscardControl({ revisionCourseId, liveCourseId }: { revisionCourseId: string; liveCourseId: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function discard() {
    setError(null)
    startTransition(async () => {
      const result = await discardCourseRevision(revisionCourseId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.push(`/learn/studio/courses/${liveCourseId}/edit`)
    })
  }

  return (
    <div className="mt-4">
      {confirming ? (
        <div
          role="group"
          aria-label="Confirm discarding these changes"
          className="rounded-xl border border-amber-200 bg-white p-4"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !pending) setConfirming(false)
          }}
        >
          <p className="text-sm font-bold text-navy-950">Discard these changes?</p>
          <p className="mt-1 text-sm leading-6 text-muted">
            The live course stays exactly as it is. Your draft changes are thrown away; you can start a new set of changes at any time.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" autoFocus disabled={pending} onClick={discard} className={primaryButton}>
              {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Trash2 aria-hidden="true" className="size-4" />}
              {pending ? 'Discarding…' : 'Discard changes'}
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirming(false)} className={secondaryButton}>
              Keep editing
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => { setError(null); setConfirming(true) }} className={secondaryButton}>
          <Trash2 aria-hidden="true" className="size-4" /> Discard changes
        </button>
      )}
      <ErrorNote error={error} />
    </div>
  )
}
