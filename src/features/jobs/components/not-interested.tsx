'use client'

import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { dismissSuggestionAction, undoDismissSuggestionAction } from '@/features/signals/actions'

/**
 * Round G (G3): "Not interested" on Jobs for you. The job leaves the list at once (stored for 180
 * days in suggestion_dismissals, so it stays gone on reload and on other devices), with Undo. A
 * failed save puts the job back with the error. Focus moves to Undo, then back to the button.
 */
type Dismiss = () => void
const DismissContext = createContext<Dismiss | null>(null)

export function NotInterestedItem({ jobId, jobTitle, as = 'div', children }: { jobId: string; jobTitle: string; as?: 'div' | 'li'; children: ReactNode }) {
  const [hidden, setHidden] = useState(false)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const undoRef = useRef<HTMLButtonElement>(null)
  const focusAfter = useRef<'undo' | 'button' | null>(null)

  useEffect(() => {
    if (focusAfter.current === 'undo') undoRef.current?.focus()
    if (focusAfter.current === 'button') document.querySelector<HTMLButtonElement>(`[data-not-interested="${jobId}"]`)?.focus()
    focusAfter.current = null
  }, [hidden, jobId])

  const dismiss = () => {
    setError('')
    focusAfter.current = 'undo'
    setHidden(true)
    startTransition(async () => {
      const result = await dismissSuggestionAction('job', jobId)
      if (!result.ok) {
        focusAfter.current = 'button'
        setHidden(false)
        setError(result.error)
      }
    })
  }

  const undo = () => {
    startTransition(async () => {
      const result = await undoDismissSuggestionAction('job', jobId)
      if (result.ok) {
        focusAfter.current = 'button'
        setHidden(false)
      } else {
        setError(result.error)
      }
    })
  }

  if (hidden) {
    const Tag = as
    return (
      <Tag role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-dashed border-mist-200 bg-white px-4 py-3 text-sm text-muted max-md:rounded-none max-md:border-x-0">
        <span className="min-w-0">We won’t show <span className="font-semibold text-navy-950">{jobTitle}</span> in Jobs for you.{error ? <span className="block text-red-700">{error}</span> : null}</span>
        <button ref={undoRef} type="button" disabled={pending} onClick={undo} className="min-h-11 rounded-full px-3 text-sm font-semibold text-ocean-700 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 disabled:opacity-60">
          Undo
        </button>
      </Tag>
    )
  }

  return (
    <DismissContext.Provider value={dismiss}>
      {children}
      {error ? <p role="alert" className="mt-1 px-4 text-xs font-semibold text-red-700">{error}</p> : null}
    </DismissContext.Provider>
  )
}

/** The trigger inside a job card ("Not interested") or a phone row (an X). Renders nothing outside Jobs for you. */
export function NotInterestedButton({ jobId, jobTitle, variant = 'text' }: { jobId: string; jobTitle: string; variant?: 'text' | 'icon' }) {
  const dismiss = useContext(DismissContext)
  if (!dismiss) return null
  if (variant === 'icon') {
    return (
      <button
        type="button"
        data-not-interested={jobId}
        aria-label={`Not interested in ${jobTitle}`}
        onClick={dismiss}
        className="relative z-10 grid size-11 cursor-pointer place-items-center rounded-full text-muted transition hover:bg-mist-50 hover:text-navy-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
      >
        <X aria-hidden="true" className="size-5" />
      </button>
    )
  }
  return (
    <button
      type="button"
      data-not-interested={jobId}
      aria-label={`Not interested in ${jobTitle}`}
      onClick={dismiss}
      className="inline-flex min-h-10 items-center rounded-xl px-3 text-sm font-semibold text-muted transition hover:bg-mist-50 hover:text-navy-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
    >
      Not interested
    </button>
  )
}
