'use client'

import { useState, useTransition } from 'react'
import { Bookmark, BookmarkCheck } from 'lucide-react'
import { saveJob, unsaveJob } from '../actions'

type SaveJobButtonVariant = 'default' | 'compact' | 'icon' | 'bar'

const VARIANT_CLASS: Record<SaveJobButtonVariant, string> = {
  default: 'inline-flex min-h-11 items-center gap-2 rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-950 transition hover:border-ocean-700 hover:bg-mist-50 disabled:opacity-60',
  compact: 'inline-flex min-h-10 items-center gap-2 rounded-xl border border-mist-200 bg-white px-3 text-sm font-semibold text-navy-950 transition hover:bg-mist-50 disabled:opacity-60',
  // Phone job rows: a bookmark icon toggle.
  icon: 'relative z-10 grid size-11 cursor-pointer place-items-center rounded-full text-navy-900 transition hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 disabled:opacity-60 [&>svg]:size-6',
  // Phone sticky apply bar: the outline pill next to the filled Apply button.
  bar: 'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full border border-ocean-700 bg-white px-5 text-[15px] font-semibold text-ocean-700 transition hover:bg-ocean-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 disabled:opacity-60',
}

export function SaveJobButton({
  jobId,
  initialSaved,
  compact = false,
  variant,
  jobTitle,
}: {
  jobId: string
  initialSaved: boolean
  compact?: boolean
  variant?: SaveJobButtonVariant
  /** Names the job in the icon button's accessible label. */
  jobTitle?: string
}) {
  const appearance: SaveJobButtonVariant = variant ?? (compact ? 'compact' : 'default')
  const [saved, setSaved] = useState(initialSaved)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const Icon = saved ? BookmarkCheck : Bookmark
  const iconOnly = appearance === 'icon'
  // aria-pressed announces the saved state, so the label stays the same.
  const iconLabel = `Save ${jobTitle ?? 'job'}`

  return (
    <div className={iconOnly ? 'relative z-10 inline-flex flex-col items-end' : 'inline-flex flex-col items-start'}>
      <button
        type="button"
        disabled={pending}
        aria-pressed={saved}
        aria-label={iconOnly ? iconLabel : undefined}
        onClick={() => {
          setError('')
          startTransition(async () => {
            const nextSaved = !saved
            const result = nextSaved ? await saveJob(jobId) : await unsaveJob(jobId)
            if (result.ok) setSaved(nextSaved)
            else setError(result.error)
          })
        }}
        className={VARIANT_CLASS[appearance]}
      >
        {iconOnly ? (
          <Bookmark aria-hidden="true" className={saved ? 'fill-navy-900' : ''} />
        ) : (
          <><Icon aria-hidden="true" className="size-4" /> {pending ? 'Saving…' : saved ? 'Saved' : 'Save'}</>
        )}
      </button>
      {error ? <span role="alert" className="mt-1 text-xs font-medium text-red-700">{error}</span> : null}
    </div>
  )
}
