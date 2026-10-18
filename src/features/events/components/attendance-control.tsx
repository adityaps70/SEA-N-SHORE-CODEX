'use client'

import { CheckCircle2 } from 'lucide-react'
import { useState, useTransition } from 'react'
import { attendEventAction, withdrawEventAttendanceAction } from '../calendar-actions'
import { buttonClass } from '@/components/ui/interactive-styles'
import { cn } from '@/lib/cn'

/** Registration closed or full: a flat grey button instead of the navy primary. */
const unavailableClass = 'bg-mist-100 text-navy-700 hover:bg-mist-100 disabled:bg-mist-100 disabled:opacity-100'

export function AttendanceControl({
  eventId,
  attending,
  disabled = false,
  paid = false,
  paidLabel,
  unavailableLabel,
  variant = 'panel',
}: {
  eventId: string
  attending: boolean
  disabled?: boolean
  /** The attendee bought a ticket; paid seats are not withdrawn here. */
  paid?: boolean
  paidLabel?: string
  /** Button text while registration is unavailable, e.g. "Event full". */
  unavailableLabel?: string
  /** `bar`: just the Register pill for the phone sticky bar (attendees see their status on the page). */
  variant?: 'panel' | 'bar'
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function run() {
    setError(null)
    startTransition(async () => {
      const result = attending
        ? await withdrawEventAttendanceAction(eventId)
        : await attendEventAction(eventId)
      if (!result.ok) setError(result.error)
    })
  }

  if (variant === 'bar' && !attending) {
    return (
      <div className="min-w-0 flex-1">
        {error ? <p role="alert" className="mb-1.5 text-xs font-medium leading-4 text-rose-700">{error}</p> : null}
        <button
          type="button"
          disabled={disabled || pending}
          onClick={run}
          className={cn(buttonClass(), 'w-full rounded-full text-[15px] font-bold', disabled && unavailableClass)}
        >
          {pending ? 'Registering…' : disabled && unavailableLabel ? unavailableLabel : 'Register for event'}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {attending ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-start gap-3" aria-live="polite">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
            <div>
              <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-emerald-900">
                {`You're attending`}
                {paid ? <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-emerald-800">Paid{paidLabel ? ` · ${paidLabel}` : ''}</span> : null}
              </p>
              <p className="mt-0.5 text-xs leading-5 text-emerald-800">
                {paid ? 'Your ticket is paid and your seat is confirmed.' : 'Your registration is confirmed.'}
              </p>
            </div>
          </div>
          {paid ? (
            <p className="mt-3 text-xs leading-5 text-emerald-900">
              Can&apos;t make it? Contact the organiser. Refunds for paid tickets are handled by the Sea N Shore team.
            </p>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={run}
              className="mt-3 min-h-11 w-full rounded-xl border border-emerald-300 bg-white px-4 text-sm font-bold text-emerald-900 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? 'Updating…' : 'Withdraw attendance'}
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled || pending}
          onClick={run}
          className={cn(buttonClass(), 'w-full font-bold', disabled && unavailableClass)}
        >
          {pending ? 'Registering…' : disabled && unavailableLabel ? unavailableLabel : 'Register for event'}
        </button>
      )}
      {error ? <p className="text-sm font-medium text-rose-700">{error}</p> : null}
    </div>
  )
}
