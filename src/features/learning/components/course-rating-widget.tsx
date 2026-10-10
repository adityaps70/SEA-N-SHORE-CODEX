'use client'

import { useState, useTransition } from 'react'
import { Clock3, MessageSquareText, ShieldCheck, Star } from 'lucide-react'
import { primaryButtonClass } from '@/components/ui/interactive-styles'
import { saveCourseReview } from '../course-rating-actions'
import type { CourseReviewEligibility, CourseReviewStatus, OwnCourseReview } from '../course-rating-repository'

/** Learning round C (C5a): "Rate this course" in the player. 1–5 stars and an optional review, moderated. */

const BODY_MAX = 2000
const RATING_WORDS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'] as const

const STATUS_COPY: Record<CourseReviewStatus, { label: string; text: string; className: string }> = {
  pending: {
    label: 'Waiting for approval',
    text: 'Sea N Shore checks every review before it appears on the course page. This usually takes a day or two.',
    className: 'border-sky-200 bg-sky-50 text-sky-950',
  },
  approved: {
    label: 'Published',
    text: 'Your rating shows on the course page. If you change it, it goes back for approval.',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  },
  rejected: {
    label: 'Not published',
    text: 'Sea N Shore didn’t publish this review. You can change it and send it again.',
    className: 'border-amber-200 bg-amber-50 text-amber-950',
  },
  removed: {
    label: 'Removed',
    text: 'This review was removed after a report. You can change it and send it again for approval.',
    className: 'border-amber-200 bg-amber-50 text-amber-950',
  },
}

function StatusNote({ status }: { status: CourseReviewStatus }) {
  const copy = STATUS_COPY[status]
  const Icon = status === 'approved' ? ShieldCheck : Clock3
  return (
    <p role="status" className={`mt-4 flex gap-2 rounded-xl border px-3.5 py-3 text-sm leading-6 ${copy.className}`}>
      <Icon aria-hidden="true" className="mt-1 size-4 shrink-0" />
      <span><span className="font-bold">{copy.label}.</span> {copy.text}</span>
    </p>
  )
}

export function CourseRatingWidget({ courseId, eligibility }: { courseId: string; eligibility: CourseReviewEligibility }) {
  const [review, setReview] = useState<OwnCourseReview | null>(eligibility.review)
  const [rating, setRating] = useState(eligibility.review?.rating ?? 0)
  const [body, setBody] = useState(eligibility.review?.body ?? '')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  // The course team never rates its own course; people who are not enrolled never see this.
  if (eligibility.reason === 'course_team' || eligibility.reason === 'not_enrolled') return null

  const heading = (
    <div className="flex items-start gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-amber-50 text-amber-700">
        <Star aria-hidden="true" className="size-5" />
      </span>
      <div className="min-w-0">
        <h2 id="rate-course-heading" className="text-lg font-bold text-navy-950">Rate this course</h2>
        <p className="mt-0.5 text-sm leading-6 text-muted">Your rating helps other seafarers choose the right course.</p>
      </div>
    </div>
  )

  const sectionClass = 'mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm max-md:-mx-4 max-md:mt-2 max-md:rounded-none max-md:border-x-0 max-md:p-4 max-md:shadow-none sm:p-8'

  if (eligibility.reason === 'progress') {
    return (
      <section aria-labelledby="rate-course-heading" className={sectionClass}>
        {heading}
        <p className="mt-4 rounded-xl bg-mist-50 px-3.5 py-3 text-sm leading-6 text-navy-900">
          You can rate this course once you’ve completed 20% of it. You’re at {eligibility.progressPercent}%.
        </p>
      </section>
    )
  }

  if (eligibility.reason === 'access_ended') {
    return (
      <section aria-labelledby="rate-course-heading" className={sectionClass}>
        {heading}
        <p className="mt-4 rounded-xl bg-mist-50 px-3.5 py-3 text-sm leading-6 text-navy-900">
          Your access to this course has ended, so you can’t rate it now.
        </p>
        {review ? <StatusNote status={review.status} /> : null}
      </section>
    )
  }

  const changed = !review || review.rating !== rating || review.body !== body.trim()

  function submit() {
    setError(null)
    setFieldErrors({})
    setSaved(false)
    if (rating < 1) {
      setFieldErrors({ rating: ['Choose from 1 to 5 stars.'] })
      return
    }
    startTransition(async () => {
      const result = await saveCourseReview(courseId, { rating, body })
      if (!result.ok) {
        setError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
        return
      }
      setReview(result.review)
      setBody(result.review.body)
      setSaved(true)
    })
  }

  const ratingError = fieldErrors.rating?.[0]
  const bodyError = fieldErrors.body?.[0]

  return (
    <section aria-labelledby="rate-course-heading" className={sectionClass}>
      {heading}

      <fieldset className="mt-5" disabled={pending} aria-describedby={ratingError ? 'course-rating-error' : undefined}>
        <legend className="text-sm font-bold text-navy-950">Your rating</legend>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((value) => (
              <label
                key={value}
                className="grid size-11 cursor-pointer place-items-center rounded-xl transition hover:bg-amber-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ocean-500"
              >
                <input
                  type="radio"
                  name={`course-rating-${courseId}`}
                  value={value}
                  checked={rating === value}
                  onChange={() => setRating(value)}
                  className="sr-only"
                  aria-label={`${value} ${value === 1 ? 'star' : 'stars'}, ${RATING_WORDS[value]}`}
                />
                <Star
                  aria-hidden="true"
                  className={`size-7 ${value <= rating ? 'fill-amber-400 text-amber-500' : 'text-slate-300'}`}
                />
              </label>
            ))}
          </div>
          <span className="text-sm font-semibold text-navy-900" aria-hidden="true">
            {rating ? `${rating} of 5 · ${RATING_WORDS[rating]}` : 'Choose 1 to 5 stars'}
          </span>
        </div>
        {ratingError ? <p id="course-rating-error" className="mt-2 text-sm font-semibold text-red-700">{ratingError}</p> : null}
      </fieldset>

      <label className="mt-5 block text-sm font-bold text-navy-950" htmlFor={`course-review-${courseId}`}>
        <span className="inline-flex items-center gap-1.5"><MessageSquareText aria-hidden="true" className="size-4" /> Your review <span className="font-normal text-muted">(optional)</span></span>
      </label>
      <textarea
        id={`course-review-${courseId}`}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        maxLength={BODY_MAX}
        rows={4}
        disabled={pending}
        aria-invalid={bodyError ? true : undefined}
        aria-describedby={`course-review-${courseId}-hint${bodyError ? ` course-review-${courseId}-error` : ''}`}
        placeholder="What did you find most useful? Who would you recommend it to?"
        className={`mt-1.5 w-full resize-y rounded-xl border bg-white px-3.5 py-2.5 text-[15px] leading-6 text-navy-950 outline-none placeholder:text-muted focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:bg-mist-50 ${bodyError ? 'border-red-400' : 'border-mist-200'}`}
      />
      <p id={`course-review-${courseId}-hint`} className="mt-1 text-xs text-muted">{body.length.toLocaleString('en-IN')}/{BODY_MAX.toLocaleString('en-IN')} characters</p>
      {bodyError ? <p id={`course-review-${courseId}-error`} className="mt-1 text-sm font-semibold text-red-700">{bodyError}</p> : null}

      {error && !ratingError && !bodyError ? <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{error}</p> : null}
      {saved ? (
        <p role="status" className="mt-3 text-sm font-semibold text-emerald-700">
          Thanks for rating this course. It will appear on the course page once Sea N Shore approves it.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={submit} disabled={pending || !changed} className={`${primaryButtonClass} max-md:w-full`}>
          {pending ? 'Saving…' : review ? 'Update rating' : 'Submit rating'}
        </button>
      </div>

      {review && !saved ? <StatusNote status={review.status} /> : null}
    </section>
  )
}
