'use client'

import { useId, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Send } from 'lucide-react'
import { primaryButtonClass } from '@/components/ui/interactive-styles'
import { postCourseAnnouncement } from '../course-announcement-actions'
import type { CourseAnnouncement } from '../course-announcement-repository'

/**
 * Learning round C (C5b): write an announcement to everyone enrolled in a course. Reusable: the Studio Announcements
 * panel and the roster's "Message all learners" both render it. Plain text only; the server checks who may post and
 * the limit of three per course in 24 hours.
 */

const TITLE_MAX = 140
const BODY_MAX = 5000

const fieldClass = 'mt-1.5 w-full rounded-xl border bg-white px-3.5 py-2.5 text-[15px] text-navy-950 outline-none placeholder:text-muted focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:bg-mist-50'

export function CourseAnnouncementComposer({
  courseId,
  onPosted,
}: {
  courseId: string
  /** Called after a successful post (the roster can close its dialog). */
  onPosted?: (announcement: CourseAnnouncement) => void
}) {
  const router = useRouter()
  const id = useId()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [sent, setSent] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setFieldErrors({})
    setSent(null)
    startTransition(async () => {
      const result = await postCourseAnnouncement(courseId, { title, body })
      if (!result.ok) {
        setError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
        return
      }
      const count = result.announcement.recipientCount ?? 0
      setSent(count === 0
        ? 'Announcement posted. No learners are enrolled yet; future learners will see it in the course.'
        : `Announcement sent to ${count.toLocaleString('en-IN')} ${count === 1 ? 'learner' : 'learners'}.`)
      setTitle('')
      setBody('')
      onPosted?.(result.announcement)
      router.refresh()
    })
  }

  const titleError = fieldErrors.title?.[0]
  const bodyError = fieldErrors.body?.[0]

  return (
    <form onSubmit={submit} noValidate aria-label="New announcement" className="space-y-4">
      <div>
        <label htmlFor={`${id}-title`} className="block text-sm font-bold text-navy-950">Title</label>
        <input
          id={`${id}-title`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={TITLE_MAX}
          disabled={pending}
          placeholder="For example: Live Q&A on Saturday"
          aria-invalid={titleError ? true : undefined}
          aria-describedby={titleError ? `${id}-title-error` : `${id}-title-count`}
          className={`${fieldClass} min-h-11 ${titleError ? 'border-red-400' : 'border-mist-200'}`}
        />
        <p id={`${id}-title-count`} className="mt-1 text-xs text-muted">{title.length}/{TITLE_MAX} characters</p>
        {titleError ? <p id={`${id}-title-error`} className="mt-1 text-sm font-semibold text-red-700">{titleError}</p> : null}
      </div>
      <div>
        <label htmlFor={`${id}-body`} className="block text-sm font-bold text-navy-950">Announcement</label>
        <textarea
          id={`${id}-body`}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={BODY_MAX}
          rows={6}
          disabled={pending}
          placeholder="Write to everyone enrolled. Plain text; line breaks are kept."
          aria-invalid={bodyError ? true : undefined}
          aria-describedby={bodyError ? `${id}-body-error` : `${id}-body-count`}
          className={`${fieldClass} resize-y leading-6 ${bodyError ? 'border-red-400' : 'border-mist-200'}`}
        />
        <p id={`${id}-body-count`} className="mt-1 text-xs text-muted">{body.length.toLocaleString('en-IN')}/{BODY_MAX.toLocaleString('en-IN')} characters</p>
        {bodyError ? <p id={`${id}-body-error`} className="mt-1 text-sm font-semibold text-red-700">{bodyError}</p> : null}
      </div>
      {error && !titleError && !bodyError ? <p role="alert" className="text-sm font-semibold text-red-700">{error}</p> : null}
      {sent ? <p role="status" className="text-sm font-semibold text-emerald-700">{sent}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={`${primaryButtonClass} max-md:w-full`}>
          <Send aria-hidden="true" className="size-4" /> {pending ? 'Sending…' : 'Send to all learners'}
        </button>
        <p className="text-xs leading-5 text-muted">Learners get it in Sea N Shore and by email (unless they turned Learning emails off).</p>
      </div>
    </form>
  )
}
