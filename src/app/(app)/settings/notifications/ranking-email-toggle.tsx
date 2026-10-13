'use client'

import { useId, useState, useTransition } from 'react'
import { setRankingEmailTopic } from '@/features/ranking/ranking-email-actions'

/** Round G: one switch per email topic (job alert emails, weekly digest). Saves as soon as it changes. */
export function RankingEmailToggle({
  topic,
  title,
  description,
  onText,
  offText,
  initiallyEnabled,
}: {
  topic: 'job_alerts' | 'weekly_digest'
  title: string
  description: string
  onText: string
  offText: string
  initiallyEnabled: boolean
}) {
  const [enabled, setEnabled] = useState(initiallyEnabled)
  const [status, setStatus] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const descriptionId = useId()

  function change(next: boolean) {
    const previous = enabled
    setEnabled(next)
    setStatus(null)
    startTransition(async () => {
      const result = await setRankingEmailTopic(topic, next)
      if (result.ok) setStatus(result.enabled ? onText : offText)
      else {
        setEnabled(previous)
        setStatus(result.error)
      }
    })
  }

  return (
    <div>
      <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4">
        <span>
          <span className="block text-[15px] font-semibold text-navy-950">{title}</span>
          <span id={descriptionId} className="mt-0.5 block text-sm leading-5 text-muted">{description}</span>
        </span>
        <span className="relative inline-flex shrink-0">
          <input
            type="checkbox"
            role="switch"
            checked={enabled}
            disabled={pending}
            aria-describedby={descriptionId}
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
