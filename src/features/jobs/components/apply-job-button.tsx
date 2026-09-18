'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, Send } from 'lucide-react'
import { applyToJob } from '../actions'

export function ApplyJobButton({ jobId, alreadyApplied, compact = false }: { jobId: string; alreadyApplied: boolean; compact?: boolean }) {
  const [submitted, setSubmitted] = useState(alreadyApplied)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  if (submitted) {
    return (
      <div className={compact ? "inline-flex min-h-10 items-center gap-2 rounded-xl bg-emerald-50 px-4 text-sm font-semibold text-emerald-800" : "inline-flex min-h-11 items-center gap-2 rounded-xl bg-mist-50 px-4 text-sm font-semibold text-ocean-700"}>
        <CheckCircle2 aria-hidden="true" className="size-4" /> {compact ? 'Applied' : 'Application submitted'}
      </div>
    )
  }

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError('')
          startTransition(async () => {
            const result = await applyToJob(jobId)
            if (result.ok) {
              setSubmitted(true)
            } else {
              setError(result.error)
            }
          })
        }}
        className={compact ? "inline-flex min-h-10 items-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-navy-900 disabled:cursor-wait disabled:opacity-60" : "inline-flex min-h-11 items-center gap-2 rounded-xl bg-navy-950 px-5 text-sm font-semibold text-white hover:bg-navy-900 disabled:cursor-wait disabled:opacity-60"}
      >
        <Send aria-hidden="true" className="size-4" /> {pending ? 'Submitting…' : compact ? 'Easy Apply' : 'Apply now'}
      </button>
      {error ? <p role="alert" className="mt-2 text-sm font-medium text-red-700">{error}</p> : null}
    </div>
  )
}
