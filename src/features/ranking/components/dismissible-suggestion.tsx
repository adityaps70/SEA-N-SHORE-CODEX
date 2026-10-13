'use client'

import { X } from 'lucide-react'
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import { dismissSuggestionAction, undoDismissSuggestionAction } from '@/features/signals/actions'

/**
 * Round G (G5): a suggestion card (organization, community, event or course) with an X. The card
 * leaves at once, the dismissal is stored for 180 days (other devices too), and Undo brings it
 * back. A failed save restores the card with the error. Focus moves to Undo, then back to the X.
 */
export function DismissibleSuggestion({
  kind,
  targetId,
  name,
  children,
  className = '',
}: {
  kind: 'org' | 'community' | 'event' | 'course'
  targetId: string
  name: string
  children: ReactNode
  className?: string
}) {
  const [hidden, setHidden] = useState(false)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const undoRef = useRef<HTMLButtonElement>(null)
  const dismissRef = useRef<HTMLButtonElement>(null)
  const focusAfter = useRef<'undo' | 'dismiss' | null>(null)

  useEffect(() => {
    if (focusAfter.current === 'undo') undoRef.current?.focus()
    if (focusAfter.current === 'dismiss') dismissRef.current?.focus()
    focusAfter.current = null
  }, [hidden])

  if (hidden) {
    return (
      <div role="status" className={`flex h-full min-h-24 flex-col items-start justify-center gap-1 rounded-2xl border border-dashed border-mist-200 bg-white p-4 text-sm text-muted ${className}`}>
        <span>We won’t suggest <span className="font-semibold text-navy-950">{name}</span> again.</span>
        {error ? <span className="text-red-700">{error}</span> : null}
        <button
          ref={undoRef}
          type="button"
          disabled={pending}
          onClick={() => startTransition(async () => {
            const result = await undoDismissSuggestionAction(kind, targetId)
            if (result.ok) {
              focusAfter.current = 'dismiss'
              setHidden(false)
            } else {
              setError(result.error)
            }
          })}
          className="min-h-11 rounded-full px-3 text-sm font-semibold text-ocean-700 hover:bg-mist-50 disabled:opacity-60"
        >
          Undo
        </button>
      </div>
    )
  }

  return (
    <div className={`relative h-full ${className}`}>
      {children}
      <button
        ref={dismissRef}
        type="button"
        aria-label={`Dismiss ${name}`}
        title="Not interested"
        onClick={() => {
          setError('')
          focusAfter.current = 'undo'
          setHidden(true)
          startTransition(async () => {
            const result = await dismissSuggestionAction(kind, targetId)
            if (!result.ok) {
              focusAfter.current = 'dismiss'
              setHidden(false)
              setError(result.error)
            }
          })
        }}
        className="absolute right-2 top-2 z-10 grid size-9 place-items-center rounded-full bg-white/90 text-navy-900 shadow-sm ring-1 ring-mist-200 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
      {error ? <p role="alert" className="mt-1 text-xs font-semibold text-red-700">{error}</p> : null}
    </div>
  )
}
