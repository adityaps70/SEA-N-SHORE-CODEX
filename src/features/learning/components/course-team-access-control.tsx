'use client'

import { ArrowRight, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { openCourseAsTeamMember } from '../enrollment-actions'

type Props = {
  courseId: string
  /** Why this person has access, e.g. "You manage this course" or "Sea N Shore team access". */
  reason: string
}

/** Course owners, organization learning managers and platform admins open the course without buying. */
export function CourseTeamAccessControl({ courseId, reason }: Props) {
  const router = useRouter()
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  async function open() {
    setOpening(true)
    setError(null)
    let result: Awaited<ReturnType<typeof openCourseAsTeamMember>>
    try {
      result = await openCourseAsTeamMember(courseId)
    } catch {
      result = { ok: false, error: 'We could not reach Sea N Shore. Check your connection and try again.' }
    }
    if (!result.ok) {
      setOpening(false)
      setError(result.error)
      return
    }
    const { href } = result
    startTransition(() => router.push(href))
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-bold text-navy-950">{reason}</p>
      <p className="text-xs leading-5 text-muted">You can open every lesson without buying. Your progress is saved like a learner&apos;s.</p>
      <button
        type="button"
        onClick={() => { void open() }}
        disabled={opening}
        aria-busy={opening || undefined}
        className="inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-navy-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-navy-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {opening ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
        {opening ? 'Opening the course…' : 'Open course'}
        {opening ? null : <ArrowRight aria-hidden="true" className="size-4" />}
      </button>
      {error ? <p role="alert" className="text-sm font-medium text-rose-700">{error}</p> : null}
    </div>
  )
}
