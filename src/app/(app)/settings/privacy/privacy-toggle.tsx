'use client'

import { useState, useTransition } from 'react'
import { setPrivacyPreference } from '@/features/profiles/privacy-actions'

/** One privacy switch that saves as soon as it changes (round G). */
export function PrivacyToggle({
  setting,
  label,
  description,
  initiallyOn,
  onMessage,
  offMessage,
}: {
  setting: 'showInPeopleSuggestions' | 'openToRecruiters'
  label: string
  description: string
  initiallyOn: boolean
  onMessage: string
  offMessage: string
}) {
  const [on, setOn] = useState(initiallyOn)
  const [status, setStatus] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function change(next: boolean) {
    const previous = on
    setOn(next)
    setStatus(null)
    startTransition(async () => {
      const result = await setPrivacyPreference(setting, next)
      if (result.ok) setStatus(result.value ? onMessage : offMessage)
      else {
        setOn(previous)
        setStatus(result.error)
      }
    })
  }

  return (
    <div>
      <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4">
        <span>
          <span className="block text-[15px] font-semibold text-navy-950">{label}</span>
          <span className="mt-0.5 block text-sm leading-5 text-muted">{description}</span>
        </span>
        <span className="relative inline-flex shrink-0">
          <input type="checkbox" role="switch" checked={on} disabled={pending} onChange={(event) => change(event.target.checked)} className="peer sr-only" />
          <span aria-hidden="true" className="h-7 w-12 rounded-full bg-mist-300 transition peer-checked:bg-ocean-700 peer-disabled:opacity-60 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ocean-500" />
          <span aria-hidden="true" className="absolute left-0.5 top-0.5 size-6 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
        </span>
      </label>
      <p role="status" className="mt-2 min-h-5 text-sm text-muted">{status}</p>
    </div>
  )
}
