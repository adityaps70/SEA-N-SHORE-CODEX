'use client'

import { useState, useTransition } from 'react'
import { MessagesSquare } from 'lucide-react'
import { secondaryButtonClass } from '@/components/ui/interactive-styles'
import { openCourseDiscussion } from '../course-community-actions'

/**
 * Learning round C (C7): "Ask the trainer / Discuss" in the player. The server re-checks the enrolment, lets the
 * learner into a private community, and opens it; anything it can't do comes back as a plain message here.
 */
export function CourseDiscussButton({ courseId, communityName }: { courseId: string; communityName: string }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function open() {
    setError(null)
    startTransition(async () => {
      const result = await openCourseDiscussion(courseId)
      // A successful call navigates to the community; only a refusal returns.
      if (result && !result.ok) setError(result.error)
    })
  }

  return (
    <div className="max-md:w-full">
      <button
        type="button"
        onClick={open}
        disabled={pending}
        aria-describedby={error ? `discuss-error-${courseId}` : undefined}
        className={`${secondaryButtonClass} max-md:min-h-11 max-md:w-full`}
        title={`Open ${communityName}`}
      >
        <MessagesSquare aria-hidden="true" className="size-4" />
        {pending ? 'Opening…' : 'Ask the trainer / Discuss'}
      </button>
      {error ? <p id={`discuss-error-${courseId}`} role="alert" className="mt-2 max-w-sm text-sm font-semibold text-red-700">{error}</p> : null}
    </div>
  )
}
