'use client'

import { CheckCircle2 } from 'lucide-react'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { attendEventAction, withdrawEventAttendanceAction } from '../calendar-actions'

export function AttendanceControl({ eventId, attending, disabled = false }: { eventId: string; attending: boolean; disabled?: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function run() {
    setError(null)
    startTransition(async () => {
      const result = attending
        ? await withdrawEventAttendanceAction(eventId)
        : await attendEventAction(eventId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-2">
      {attending ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-start gap-3" aria-live="polite">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
            <div>
              <p className="text-sm font-bold text-emerald-900">You&apos;re attending</p>
              <p className="mt-0.5 text-xs leading-5 text-emerald-800">Your registration is confirmed.</p>
            </div>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={run}
            className="mt-3 min-h-11 w-full rounded-xl border border-emerald-300 bg-white px-4 text-sm font-bold text-emerald-900 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? 'Updating…' : 'Withdraw attendance'}
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled || pending}
          onClick={run}
          className="min-h-12 w-full rounded-xl bg-teal-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Registering…' : 'Register for event'}
        </button>
      )}
      {error ? <p className="text-sm font-medium text-rose-700">{error}</p> : null}
    </div>
  )
}
