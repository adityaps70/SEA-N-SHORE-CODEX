import Link from 'next/link'
import { Star } from 'lucide-react'
import { ReportContentButton } from '@/features/moderation/components/report-content-button'
import type { PublicCourseReviews } from '../course-rating-repository'

/**
 * Learning round C (C5a): the course page's ratings: the average and count of approved reviews, then the reviews
 * themselves. Signed-in members can report a review (never their own).
 */

export function formatAverageRating(value: number) {
  return value.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

export function StarRow({ rating, size = 'size-4' }: { rating: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((value) => (
        <Star key={value} className={`${size} ${value <= Math.round(rating) ? 'fill-amber-400 text-amber-500' : 'text-slate-300'}`} />
      ))}
    </span>
  )
}

function reviewDate(value: string) {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(value))
}

export function CourseReviewsSection({
  data,
  viewerId,
  className = '',
}: {
  data: PublicCourseReviews
  viewerId: string | null
  className?: string
}) {
  if (data.reviewCount === 0 || data.averageRating === null) return null
  const average = formatAverageRating(data.averageRating)
  return (
    <section id="course-reviews" aria-labelledby="course-reviews-heading" className={className}>
      <h2 id="course-reviews-heading" className="text-section-title font-bold text-navy-950 max-md:text-lg">Ratings and reviews</h2>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="text-4xl font-extrabold tracking-tight text-navy-950">{average}</span>
        <div>
          <StarRow rating={data.averageRating} size="size-5" />
          <p className="mt-0.5 text-sm text-muted">
            <span className="sr-only">Average rating {average} out of 5, from </span>
            {data.reviewCount.toLocaleString('en-IN')} {data.reviewCount === 1 ? 'rating' : 'ratings'}
          </p>
        </div>
      </div>
      <ul className="mt-5 divide-y divide-mist-100">
        {data.reviews.map((review) => (
          <li key={review.id} className="py-4 first:pt-0">
            <article aria-label={`Review by ${review.reviewer.name}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {review.reviewer.slug ? (
                  <Link href={`/people/${review.reviewer.slug}`} className="text-sm font-bold text-navy-950 hover:underline">{review.reviewer.name}</Link>
                ) : (
                  <span className="text-sm font-bold text-navy-950">{review.reviewer.name}</span>
                )}
                <StarRow rating={review.rating} />
                <span className="sr-only">{review.rating} out of 5 stars</span>
                <time dateTime={review.reviewedAt} className="text-xs text-muted">{reviewDate(review.reviewedAt)}</time>
                {viewerId && viewerId !== review.reviewer.id ? (
                  <span className="ml-auto">
                    <ReportContentButton targetType="course_review" targetId={review.id} label="Report review" iconOnly />
                  </span>
                ) : null}
              </div>
              {review.body ? <p className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-7 text-navy-900">{review.body}</p> : null}
            </article>
          </li>
        ))}
      </ul>
    </section>
  )
}
