'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, CircleAlert, Loader2 } from 'lucide-react'
import { completeLearningLesson } from '../learner-progress-actions'
import { LESSON_COMPLETED_EVENT, lessonIdFromEvent } from '../lesson-completion-events'

type CompletionRule = 'manual' | 'view' | 'media_percentage' | 'quiz_pass' | 'assignment_submit' | 'scorm_completion'

/** What a learner still has to do before moving on (the completion rule, enforced on the server). */
export function pendingCompletionHint(rule: CompletionRule, threshold: number | null) {
  if (rule === 'media_percentage') return `Play ${threshold ?? 90}% of this material to continue.`
  if (rule === 'quiz_pass') return 'Pass the quiz to continue.'
  if (rule === 'assignment_submit') return 'Submit the assignment to continue.'
  if (rule === 'scorm_completion') return 'Finish the module to continue.'
  if (rule === 'view') return 'Opening this material completes it.'
  return null
}

/**
 * Learning round E (E4): the player's one action bar for every lesson type, sticky at the bottom of the
 * lesson: "← Previous" and "Complete & next →". Moving on is enabled only once the lesson's completion
 * rule is met (round A): a manual lesson completes from this button; the others complete themselves
 * (video watched, quiz passed, assignment submitted) and the button unlocks then.
 */
export function LessonActionBar({
  slug,
  lessonId,
  completionRule,
  completionThreshold = null,
  completed: completedOnServer,
  available,
  previousHref,
  nextHref,
  finishHref,
  phoneStart,
  docked = true,
}: {
  slug: string
  lessonId: string
  completionRule: CompletionRule
  completionThreshold?: number | null
  completed: boolean
  available: boolean
  previousHref: string | null
  nextHref: string | null
  /** Where the last lesson's button goes once the course is done (My Learning). */
  finishHref: string
  /** Phones: the "Curriculum n/N" button, at the start of the bar. */
  phoneStart?: ReactNode
  /**
   * Sticky at the bottom of the lesson (fixed on phones), the default. S2: a full-height SCORM lesson puts the
   * bar in the page flow under the frame instead, so it can never cover the package.
   */
  docked?: boolean
}) {
  const router = useRouter()
  const [completedHere, setCompletedHere] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const completed = completedOnServer || completedHere

  useEffect(() => {
    function onCompleted(event: Event) {
      if (lessonIdFromEvent(event) === lessonId) setCompletedHere(true)
    }
    window.addEventListener(LESSON_COMPLETED_EVENT, onCompleted)
    return () => window.removeEventListener(LESSON_COMPLETED_EVENT, onCompleted)
  }, [lessonId])

  async function completeAndContinue() {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const result = await completeLearningLesson(slug, lessonId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setCompletedHere(true)
      // Completing revalidated the page; only moving on needs a navigation.
      if (nextHref && !result.enrollmentCompleted) router.push(nextHref)
    } catch {
      setError('We could not update your lesson progress. Please try again.')
    } finally {
      setPending(false)
    }
  }

  const primaryClass = 'inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-navy-950 px-5 text-sm font-semibold text-white transition hover:bg-navy-800 disabled:cursor-not-allowed disabled:bg-mist-200 disabled:text-muted max-md:flex-1 max-md:rounded-full'
  const manual = completionRule === 'manual'
  let primary: ReactNode
  if (!available) {
    primary = nextHref ? (
      <Link href={nextHref} className={primaryClass}>Next <ArrowRight aria-hidden="true" className="size-4" /></Link>
    ) : null
  } else if (completed) {
    primary = nextHref ? (
      <Link href={nextHref} className={primaryClass}>Next lesson <ArrowRight aria-hidden="true" className="size-4" /></Link>
    ) : (
      <Link href={finishHref} className={primaryClass}>Back to My Learning</Link>
    )
  } else if (manual) {
    primary = (
      <button type="button" disabled={pending} onClick={() => void completeAndContinue()} className={primaryClass}>
        {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
        {pending ? 'Saving…' : nextHref ? <>Complete &amp; next <ArrowRight aria-hidden="true" className="size-4" /></> : 'Mark complete'}
      </button>
    )
  } else {
    primary = (
      <button type="button" disabled aria-describedby={`${lessonId}-hint`} className={primaryClass}>
        {nextHref ? <>Complete &amp; next <ArrowRight aria-hidden="true" className="size-4" /></> : 'Complete'}
      </button>
    )
  }
  const hint = available && !completed && !manual ? pendingCompletionHint(completionRule, completionThreshold) : null

  return (
    <div
      data-lesson-action-bar=""
      data-docked={docked ? 'on' : 'off'}
      className={docked
        ? 'sticky bottom-0 z-20 -mx-6 mt-8 border-t border-mist-200 bg-white/95 px-6 py-3 backdrop-blur sm:-mx-8 sm:px-8 max-md:fixed max-md:inset-x-0 max-md:mx-0 max-md:mt-0 max-md:px-4 max-md:pb-[calc(0.75rem+env(safe-area-inset-bottom))]'
        : 'relative border-t border-mist-200 bg-white px-4 py-2.5 sm:px-5 max-md:pb-[calc(0.625rem+env(safe-area-inset-bottom))] md:rounded-b-3xl'}
    >
      {error ? (
        <p role="status" className="mb-2 flex items-start gap-2 text-sm text-rose-800">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      ) : null}
      <nav aria-label="Lesson navigation" className="flex items-center gap-3">
        {phoneStart ? <div className="flex lg:hidden">{phoneStart}</div> : null}
        {previousHref ? (
          <Link
            href={previousHref}
            aria-label="Previous lesson"
            className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-900 transition hover:bg-mist-50 max-md:rounded-full max-md:px-0"
          >
            <ArrowLeft aria-hidden="true" className="size-4" /><span className="max-md:sr-only">Previous</span>
          </Link>
        ) : null}
        {hint ? <p id={`${lessonId}-hint`} className="min-w-0 flex-1 text-right text-meta text-muted max-md:hidden">{hint}</p> : <span className="flex-1 max-md:hidden" />}
        {primary}
      </nav>
      {hint ? <p className="mt-2 text-meta text-muted md:hidden">{hint}</p> : null}
    </div>
  )
}
