'use client'

import { useState, useTransition } from 'react'
import { setLearningEmailPreference } from '@/features/learning/learning-email-actions'

/** One switch: learning emails on or off. Saves as soon as it changes. */
export function LearningEmailToggle({ initiallyEnabled }: { initiallyEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initiallyEnabled)
  const [status, setStatus] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function change(next: boolean) {
    const previous = enabled
    setEnabled(next)
    setStatus(null)
    startTransition(async () => {
      const result = await setLearningEmailPreference(next)
      if (result.ok) {
        setStatus(result.enabled ? 'Learning emails are on.' : 'Learning emails are off. You still see these updates in Notifications.')
      } else {
        setEnabled(previous)
        setStatus(result.error)
      }
    })
  }

  return (
    <div>
      <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4">
        <span>
          <span className="block text-[15px] font-semibold text-navy-950">Learning emails</span>
          <span className="mt-0.5 block text-sm leading-5 text-muted">
            Enrolments, new course materials, grades, certificates and, for trainers, course reviews and submissions to grade.
          </span>
        </span>
        <span className="relative inline-flex shrink-0">
          <input
            type="checkbox"
            role="switch"
            checked={enabled}
            disabled={pending}
            onChange={(event) => change(event.target.checked)}
            className="peer sr-only"
          />
          <span aria-hidden="true" className="h-7 w-12 rounded-full bg-mist-300 transition peer-checked:bg-ocean-700 peer-disabled:opacity-60 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ocean-500" />
          <span aria-hidden="true" className="absolute left-0.5 top-0.5 size-6 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
        </span>
      </label>
      <p role="status" className="mt-2 min-h-5 text-sm text-muted">{status}</p>
    </div>
  )
}
