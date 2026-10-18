'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { enrollInFreeCourse } from '../enrollment-actions'
import { CourseCheckoutButton } from './course-checkout-button'
import { buttonClass } from '@/components/ui/interactive-styles'
import { cn } from '@/lib/cn'

/**
 * Phone course page (round 8): the main action as a sticky bottom bar above the tab bar.
 * It reuses the same free-enrollment action and gateway checkout as the "Course access" card,
 * which stays on the page for every other state (pending payment, team access, refunds).
 */
export type CourseActionBarMode =
  | { kind: 'enroll' }
  | { kind: 'continue'; label: 'Continue learning' | 'Review course' }
  | { kind: 'buy'; priceLabel: string }
  /** Round C: several plans (or a renewal) are chosen in the "Course access" card. */
  | { kind: 'choose'; label: string }

const PRIMARY =
  cn(buttonClass(), 'w-full rounded-full text-[15px] font-bold')

export function CourseActionBar({
  course,
  mode,
}: {
  course: { id: string; slug: string; title: string }
  mode: CourseActionBarMode
}) {
  const [pending, startTransition] = useTransition()
  const [enrolled, setEnrolled] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const learnHref = `/learn/courses/${course.slug}/learn`

  function enroll() {
    setError(null)
    startTransition(async () => {
      const result = await enrollInFreeCourse(course.id)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setEnrolled(true)
    })
  }

  let action: React.ReactNode
  if (mode.kind === 'continue' || (mode.kind === 'enroll' && enrolled)) {
    action = (
      <Link href={learnHref} className={PRIMARY}>
        {mode.kind === 'continue' ? mode.label : 'Continue learning'} <ArrowRight aria-hidden="true" className="size-4" />
      </Link>
    )
  } else if (mode.kind === 'choose') {
    action = (
      <a href="#course-access" className={PRIMARY}>
        {mode.label} <ArrowRight aria-hidden="true" className="size-4" />
      </a>
    )
  } else if (mode.kind === 'enroll') {
    action = (
      <button type="button" onClick={enroll} disabled={pending} className={PRIMARY}>
        {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
        {pending ? 'Enrolling…' : 'Enroll free'}
      </button>
    )
  } else {
    action = (
      <CourseCheckoutButton
        compact
        courseId={course.id}
        courseSlug={course.slug}
        courseTitle={course.title}
        priceLabel={mode.priceLabel}
        paymentsConfigured
      />
    )
  }

  return (
    <div
      data-testid="course-action-bar"
      className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 order-last -mx-4 mt-4 border-t border-mist-100 bg-white px-4 py-3 shadow-[0_-8px_24px_rgb(7_27_45/0.08)] md:hidden"
    >
      {error ? <p role="status" className="mb-2 text-sm font-medium text-red-700">{error}</p> : null}
      {action}
    </div>
  )
}
