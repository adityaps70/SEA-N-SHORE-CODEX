'use client'

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
      <button type="button" disabled={disabled || pending} onClick={run} className={`w-full rounded-xl px-5 py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${attending ? 'border border-navy-200 bg-white text-navy-900 hover:bg-mist-50' : 'bg-teal-600 text-white hover:bg-teal-700'}`}>
        {pending ? 'Updating…' : attending ? 'Withdraw attendance' : 'Attend event'}
      </button>
      {error ? <p className="text-sm font-medium text-rose-700">{error}</p> : null}
    </div>
  )
}
