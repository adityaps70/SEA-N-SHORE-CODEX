'use client'

import { useState, useTransition } from 'react'
import { Bookmark, BookmarkCheck } from 'lucide-react'
import { saveJob, unsaveJob } from '../actions'

export function SaveJobButton({ jobId, initialSaved, compact = false }: { jobId: string; initialSaved: boolean; compact?: boolean }) {
  const [saved, setSaved] = useState(initialSaved)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const Icon = saved ? BookmarkCheck : Bookmark

  return (
    <div className="inline-flex flex-col items-start">
      <button
        type="button"
        disabled={pending}
        aria-pressed={saved}
        onClick={() => {
          setError('')
          startTransition(async () => {
            const nextSaved = !saved
            const result = nextSaved ? await saveJob(jobId) : await unsaveJob(jobId)
            if (result.ok) setSaved(nextSaved)
            else setError(result.error)
          })
        }}
        className={compact
          ? 'inline-flex min-h-10 items-center gap-2 rounded-xl border border-mist-100 bg-white px-3 text-sm font-semibold text-navy-950 transition hover:bg-mist-50 disabled:opacity-60'
          : 'inline-flex min-h-11 items-center gap-2 rounded-xl border border-mist-100 bg-white px-4 text-sm font-semibold text-navy-950 transition hover:border-ocean-700 hover:bg-mist-50 disabled:opacity-60'}
      >
        <Icon aria-hidden="true" className="size-4" /> {pending ? 'Saving…' : saved ? 'Saved' : 'Save'}
      </button>
      {error ? <span role="alert" className="mt-1 text-xs font-medium text-red-700">{error}</span> : null}
    </div>
  )
}
