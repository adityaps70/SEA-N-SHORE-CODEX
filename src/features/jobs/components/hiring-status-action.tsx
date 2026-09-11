'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateHiringApplicationStatus } from '../hiring-actions'
import type { JobApplicationStatus } from '../types'

const actions: Array<{ label: string; status: JobApplicationStatus; tone: string }> = [
  { label: 'Shortlist', status: 'shortlisted', tone: 'bg-emerald-600 text-white hover:bg-emerald-700' },
  { label: 'Interview', status: 'interview', tone: 'bg-teal-700 text-white hover:bg-teal-800' },
  { label: 'Select', status: 'selected', tone: 'bg-navy-950 text-white hover:bg-navy-900' },
  { label: 'Reject', status: 'rejected', tone: 'border border-rose-200 bg-white text-rose-700 hover:bg-rose-50' },
]

export function HiringStatusAction({ applicationId, currentStatus }: { applicationId: string; currentStatus: JobApplicationStatus }) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function changeStatus(status: JobApplicationStatus) {
    setError(null)
    startTransition(async () => {
      const result = await updateHiringApplicationStatus(applicationId, status, note.trim() || null)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setNote('')
      router.refresh()
    })
  }

  return (
    <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">Recruiter actions</p>
        <h2 className="mt-1 text-xl font-bold text-navy-950">Move candidate</h2>
        <p className="mt-1 text-sm text-muted">Every status change is added to the immutable application timeline.</p>
      </div>

      <label className="mt-5 block">
        <span className="text-sm font-bold text-navy-950">Status note <span className="font-medium text-muted">(optional)</span></span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="Add interview timing, shortlist reason or internal context that may be useful later."
          className="mt-2 w-full rounded-xl border border-mist-200 bg-white px-3 py-2.5 text-sm text-navy-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
        />
      </label>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {actions.map((action) => (
          <button
            key={action.status}
            type="button"
            disabled={pending || currentStatus === action.status}
            onClick={() => changeStatus(action.status)}
            className={`min-h-11 rounded-xl px-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-45 ${action.tone}`}
          >
            {currentStatus === action.status ? `${action.label}ed` : action.label}
          </button>
        ))}
      </div>

      {error ? <p className="mt-3 text-sm font-semibold text-rose-700">{error}</p> : null}
    </section>
  )
}
