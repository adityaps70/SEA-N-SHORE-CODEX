'use client'

import { useState } from 'react'
import { CheckCircle2, CircleAlert, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { completeLearningLesson } from '../learner-progress-actions'
import { buttonClass } from '@/components/ui/interactive-styles'
import { cn } from '@/lib/cn'

type LessonCompletionControlProps = {
  slug: string
  lessonId: string
  initiallyCompleted: boolean
  nextLessonHref?: string | null
}

export function LessonCompletionControl({
  slug,
  lessonId,
  initiallyCompleted,
  nextLessonHref = null,
}: LessonCompletionControlProps) {
  const router = useRouter()
  const [completed, setCompleted] = useState(initiallyCompleted)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onComplete() {
    if (pending || completed) return

    setPending(true)
    setError(null)

    try {
      const result = await completeLearningLesson(slug, lessonId)
      if (!result.ok) {
        setError(result.error)
        return
      }

      setCompleted(true)
      // Completing revalidated the lesson page; only moving on needs a navigation.
      if (!result.enrollmentCompleted && nextLessonHref) router.push(nextLessonHref)
    } catch {
      setError('We could not update your lesson progress. Please try again.')
    } finally {
      setPending(false)
    }
  }

  if (completed) {
    return (
      <div className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 max-md:min-h-11 max-md:justify-center max-md:rounded-full" role="status">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        Completed
      </div>
    )
  }

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => void onComplete()}
        className={cn(buttonClass(), 'max-md:w-full max-md:rounded-full max-md:text-[15px] max-md:font-bold')}
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-5 w-5 md:hidden" aria-hidden="true" />}
        {pending ? 'Saving…' : nextLessonHref ? 'Complete & next' : 'Mark complete'}
      </button>

      {error ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900" role="status">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  )
}
