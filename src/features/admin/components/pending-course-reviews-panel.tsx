'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { CheckCircle2, Star, XCircle } from 'lucide-react'
import { decideCourseReview } from '@/features/learning/course-rating-actions'
import type { PendingCourseReview } from '@/features/learning/course-rating-repository'

/**
 * Learning round C (C5a): course reviews waiting for approval, on the admin moderation page. Approve publishes a
 * review on its course page; Reject keeps it private (the learner can change it and send it again). Reports about
 * published reviews arrive in the report queue below like any other content.
 */

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function PendingReviewCard({ review }: { review: PendingCourseReview }) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [done, setDone] = useState(false)
  const [pending, startTransition] = useTransition()
  const flagged = review.screening.decision !== 'allow'

  function decide(decision: 'approved' | 'rejected') {
    setMessage(null)
    startTransition(async () => {
      const result = await decideCourseReview({ reviewId: review.id, decision, note: note.trim() || undefined, expectedUpdatedAt: review.updatedAt })
      if (!result.ok) {
        setMessage({ tone: 'error', text: result.error })
        return
      }
      setDone(true)
      setMessage({ tone: 'success', text: decision === 'approved' ? 'Approved. The review now shows on the course page.' : 'Rejected. The review stays private.' })
      router.refresh()
    })
  }

  return (
    <article aria-label={`Review of ${review.course.title}`} className="rounded-xl border border-mist-100 bg-white p-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-navy-950 px-2.5 py-1 text-xs font-bold uppercase tracking-[0.08em] text-white">Course review</span>
            {review.edited ? <span className="rounded-full bg-mist-50 px-2.5 py-1 text-xs font-bold text-muted">Edited</span> : null}
            {flagged ? (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800">
                Automated screening: {review.screening.category?.replaceAll('_', ' ') ?? 'review'}
              </span>
            ) : null}
          </div>
          <h3 className="mt-3 text-lg font-bold text-navy-950">
            <Link href={`/learn/courses/${review.course.slug}`} className="hover:underline">{review.course.title}</Link>
          </h3>
          <p className="mt-1 flex items-center gap-1 text-sm font-semibold text-navy-900">
            <span className="inline-flex" aria-hidden="true">
              {[1, 2, 3, 4, 5].map((value) => (
                <Star key={value} className={`size-4 ${value <= review.rating ? 'fill-amber-400 text-amber-500' : 'text-slate-300'}`} />
              ))}
            </span>
            {review.rating} of 5
          </p>
          {review.body ? (
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-ink">{review.body}</p>
          ) : (
            <p className="mt-3 text-sm italic text-muted">Stars only, no written review.</p>
          )}
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs font-medium text-muted">
            <span>{review.edited ? 'Changed' : 'Written'}: {formatDate(review.updatedAt)}</span>
            {review.reviewer.slug
              ? <Link href={`/people/${review.reviewer.slug}`} className="font-semibold text-ocean-700 hover:underline">By {review.reviewer.name}</Link>
              : <span>By {review.reviewer.name}</span>}
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-mist-100 bg-mist-50/70 p-4">
          <label className="block text-xs font-bold uppercase tracking-[0.12em] text-muted">
            Moderator note (optional)
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              maxLength={4000}
              disabled={pending || done}
              placeholder="Why you rejected it, for the audit log."
              className="mt-2 w-full resize-y rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-ink outline-none focus:border-ocean-500"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || done}
              onClick={() => decide('approved')}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-sm font-bold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CheckCircle2 aria-hidden="true" className="size-4" /> Approve
            </button>
            <button
              type="button"
              disabled={pending || done}
              onClick={() => decide('rejected')}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-red-700 px-3 text-sm font-bold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <XCircle aria-hidden="true" className="size-4" /> Reject
            </button>
          </div>
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

export function PendingCourseReviewsPanel({ reviews }: { reviews: PendingCourseReview[] }) {
  return (
    <section aria-labelledby="pending-course-reviews-heading" className="space-y-3">
      <div>
        <h2 id="pending-course-reviews-heading" className="text-lg font-bold text-navy-950">Course reviews to approve</h2>
        <p className="text-sm text-muted">
          {reviews.length
            ? `${reviews.length} ${reviews.length === 1 ? 'review is' : 'reviews are'} waiting. Reviews appear on course pages only after approval; an edited review comes back here.`
            : 'No course reviews are waiting for approval.'}
        </p>
      </div>
      {reviews.map((review) => <PendingReviewCard key={`${review.id}-${review.updatedAt}`} review={review} />)}
    </section>
  )
}
