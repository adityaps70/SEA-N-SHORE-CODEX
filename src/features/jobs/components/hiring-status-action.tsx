'use client'

import { useId, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { HIRING_APPLICATION_STATUS_LABELS, type OwnerSettableApplicationStatus } from '../application-status'
import { updateHiringApplicationStatus } from '../hiring-actions'
import type { JobApplicationStatus } from '../types'

/** Owner actions, in pipeline order. Each maps onto an existing application status value. */
const actions: Array<{ label: string; status: OwnerSettableApplicationStatus; tone: string }> = [
  { label: 'Mark reviewed', status: 'under_review', tone: 'border border-mist-200 bg-white text-navy-950 hover:bg-mist-50' },
  { label: 'Shortlist', status: 'shortlisted', tone: 'bg-emerald-600 text-white hover:bg-emerald-700' },
  { label: 'Interview', status: 'interview', tone: 'bg-teal-700 text-white hover:bg-teal-800' },
  { label: 'Hire', status: 'selected', tone: 'bg-navy-950 text-white hover:bg-navy-900' },
  { label: 'Reject', status: 'rejected', tone: 'border border-rose-200 bg-white text-rose-700 hover:bg-rose-50' },
]

/** Status-change logic shared by the desktop status card and the phone sticky bar. */
export function useHiringStatusChange(applicationId: string) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [pendingStatus, setPendingStatus] = useState<OwnerSettableApplicationStatus | null>(null)

  function changeStatus(status: OwnerSettableApplicationStatus, onDone?: () => void) {
    setError(null)
    setSuccess(null)
    setPendingStatus(status)
    startTransition(async () => {
      const result = await updateHiringApplicationStatus(applicationId, status, note.trim() || null)
      setPendingStatus(null)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setNote('')
      setSuccess(`Moved to ${HIRING_APPLICATION_STATUS_LABELS[status]}. The applicant can see this on their application timeline.`)
      onDone?.()
      router.refresh()
    })
  }

  function reset() {
    setError(null)
    setSuccess(null)
  }

  return { note, setNote, error, success, pending, pendingStatus, changeStatus, reset }
}

export function HiringStatusAction({ applicationId, currentStatus }: { applicationId: string; currentStatus: JobApplicationStatus }) {
  const noteId = useId()
  const { note, setNote, error, success, pending, pendingStatus, changeStatus } = useHiringStatusChange(applicationId)

  return (
    <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">Application status</p>
        <h2 className="mt-1 text-xl font-bold text-navy-950">
          Currently: {HIRING_APPLICATION_STATUS_LABELS[currentStatus]}
        </h2>
        <p className="mt-1 text-sm text-muted">Every change is added to the application history.</p>
      </div>

      {currentStatus === 'withdrawn' ? (
        <p className="mt-5 rounded-xl bg-mist-50 px-3 py-2.5 text-sm font-semibold text-navy-900">
          The applicant withdrew this application, so its status can no longer be changed.
        </p>
      ) : (
        <>
          <label htmlFor={noteId} className="mt-5 block">
            <span className="text-sm font-bold text-navy-950">Message to the applicant <span className="font-medium text-muted">(optional)</span></span>
            <span className="mt-0.5 block text-xs text-muted">Shown to the applicant on their application timeline. Use private notes for internal context.</span>
          </label>
          <textarea
            id={noteId}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="For example: interview timing or next steps."
            className="mt-2 w-full rounded-xl border border-mist-200 bg-white px-3 py-2.5 text-sm text-navy-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
          />

          <div className="mt-4 flex flex-wrap gap-2">
            {actions.map((action) => {
              const current = currentStatus === action.status
              return (
                <button
                  key={action.status}
                  type="button"
                  aria-pressed={current}
                  disabled={pending || current}
                  onClick={() => changeStatus(action.status)}
                  className={`min-h-11 flex-1 basis-[8.5rem] whitespace-nowrap rounded-xl px-3 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 ${action.tone}`}
                >
                  {pendingStatus === action.status ? 'Saving…' : current ? `${HIRING_APPLICATION_STATUS_LABELS[action.status]} ✓` : action.label}
                </button>
              )
            })}
          </div>
        </>
      )}

      {error ? <p role="alert" className="mt-3 text-sm font-semibold text-rose-700">{error}</p> : null}
      {success ? <p role="status" className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{success}</p> : null}
    </section>
  )
}
