'use client'

import { useId, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import IntentLink from '@/components/navigation/intent-link'
import { Button } from '@/components/ui/button'
import { pluralize } from '@/lib/format'
import { setCourseReviewReplyStatus } from '@/features/learning/course-review-reply-actions'
import type { CourseReviewReplyStatus, ModerationCourseReviewReply } from '@/features/learning/course-rating-repository'

/**
 * Round H: course owners' replies to reviews, newest first, on the admin moderation page. Hide takes a reply off the
 * course page (the owner still sees it, marked hidden); Restore shows it again. Both are recorded in the audit log.
 */

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function ReplyCard({ reply }: { reply: ModerationCourseReviewReply }) {
  const router = useRouter()
  const id = useId()
  const [status, setStatus] = useState<CourseReviewReplyStatus>(reply.status)
  const [note, setNote] = useState('')
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const hidden = status === 'hidden'

  function change(next: CourseReviewReplyStatus) {
    setMessage(null)
    startTransition(async () => {
      const result = await setCourseReviewReplyStatus({ reviewId: reply.reviewId, status: next, note: note.trim() || undefined })
      if (!result.ok) {
        setMessage({ tone: 'error', text: result.error })
        return
      }
      setStatus(next)
      setNote('')
      setMessage({ tone: 'success', text: next === 'hidden' ? 'Hidden. The reply no longer shows on the course page.' : 'Restored. The reply shows on the course page again.' })
      router.refresh()
    })
  }

  return (
    <article aria-label={`Reply on ${reply.course.title}`} className="rounded-xl border border-mist-100 bg-white p-5 max-md:p-4">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-navy-950 px-2.5 py-1 text-xs font-bold uppercase tracking-[0.08em] text-white">Owner reply</span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${hidden ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}>
              {hidden ? 'Hidden' : 'Visible'}
            </span>
          </div>
          <h3 className="mt-3 text-lg font-bold text-navy-950">
            <IntentLink href={`/learn/courses/${reply.course.slug}#course-reviews`} className="hover:underline">{reply.course.title}</IntentLink>
          </h3>
          <p className="mt-2 text-xs font-bold uppercase tracking-[0.08em] text-muted">Review, {reply.reviewRating} of 5</p>
          {reply.reviewBody ? (
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm leading-6 text-ink">{reply.reviewBody}</p>
          ) : (
            <p className="mt-1 text-sm italic text-muted">Stars only, no written review.</p>
          )}
          <p className="mt-3 text-xs font-bold uppercase tracking-[0.08em] text-muted">Reply from {reply.publisherName}</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-ink">{reply.body}</p>
          <p className="mt-3 text-xs font-medium text-muted">Written: {formatDate(reply.repliedAt)}</p>
        </div>

        <div className="space-y-3 rounded-2xl border border-mist-100 bg-mist-50/70 p-4">
          <label htmlFor={`${id}-note`} className="block text-xs font-bold uppercase tracking-[0.12em] text-muted">Moderator note (optional)</label>
          <textarea
            id={`${id}-note`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            maxLength={4000}
            disabled={pending}
            placeholder="Why you hid or restored it, for the audit log."
            className="w-full resize-y rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-ocean-500"
          />
          {hidden ? (
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => change('visible')} className="max-md:w-full">
              <Eye aria-hidden="true" className="size-4" /> Restore reply
            </Button>
          ) : (
            <Button size="sm" disabled={pending} onClick={() => change('hidden')} className="bg-red-700 hover:bg-red-800 disabled:bg-red-700 max-md:w-full">
              <EyeOff aria-hidden="true" className="size-4" /> Hide reply
            </Button>
          )}
          {message ? (
            <p role="status" aria-live="polite" className={`rounded-xl px-3 py-2 text-xs font-semibold ${message.tone === 'error' ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>
              {message.text}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  )
}

export function CourseReviewRepliesPanel({ replies }: { replies: ModerationCourseReviewReply[] }) {
  const hiddenCount = replies.filter((reply) => reply.status === 'hidden').length
  return (
    <section aria-labelledby="course-review-replies-heading" className="space-y-3">
      <div>
        <h2 id="course-review-replies-heading" className="text-lg font-bold text-navy-950">Course owners’ replies to reviews</h2>
        <p className="text-sm text-muted">
          {replies.length
            ? `The newest ${pluralize(replies.length, 'reply', 'replies')}${hiddenCount ? `, ${hiddenCount} hidden` : ''}. Replies show under reviews on course pages; hide one that breaks the rules.`
            : 'No course owner has replied to a review yet.'}
        </p>
      </div>
      {replies.map((reply) => <ReplyCard key={`${reply.reviewId}-${reply.repliedAt}`} reply={reply} />)}
    </section>
  )
}
