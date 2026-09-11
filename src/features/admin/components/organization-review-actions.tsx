'use client'

import { useState, useTransition } from 'react'
import { reviewOrganizationApplication } from '../actions'
import type { AdminOrganizationDecision, AdminOrganizationStatus } from '../repository'

export function OrganizationReviewActions({
  applicationId,
  status,
}: {
  applicationId: string
  status: AdminOrganizationStatus
}) {
  const [reviewerNote, setReviewerNote] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)
  const [isPending, startTransition] = useTransition()

  const decisions: Array<{ decision: AdminOrganizationDecision; label: string; className: string }> = status === 'pending'
    ? [
        { decision: 'approved', label: 'Approve organization', className: 'bg-emerald-700 text-white hover:bg-emerald-800' },
        { decision: 'changes_requested', label: 'Request changes', className: 'bg-amber-100 text-amber-950 hover:bg-amber-200' },
        { decision: 'rejected', label: 'Reject application', className: 'bg-red-50 text-red-800 hover:bg-red-100' },
      ]
    : status === 'approved'
      ? [{ decision: 'suspended', label: 'Suspend hiring access', className: 'bg-red-700 text-white hover:bg-red-800' }]
      : []

  function submit(decision: AdminOrganizationDecision) {
    setMessage(null)
    setIsError(false)
    if (decision !== 'approved' && !reviewerNote.trim()) {
      setIsError(true)
      setMessage('Add a reviewer note before taking this action.')
      return
    }

    startTransition(async () => {
      const result = await reviewOrganizationApplication(applicationId, decision, reviewerNote)
      if (!result.ok) {
        setIsError(true)
        setMessage(result.error)
        return
      }
      setMessage('Review decision saved.')
      window.location.reload()
    })
  }

  if (decisions.length === 0) {
    return (
      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <h2 className="text-lg font-bold text-navy-950">Review decision</h2>
        <p className="mt-2 text-sm leading-6 text-muted">This application is not currently waiting for an administrator decision.</p>
      </section>
    )
  }

  return (
    <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Decision</p>
        <h2 className="mt-1 text-xl font-bold text-navy-950">Organization review</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Approval activates the verified company and founding owner. Changes, rejection and suspension require a reviewer note for a clear audit trail.
        </p>
      </div>

      <label className="mt-5 block text-sm font-semibold text-navy-900">
        Reviewer note
        <textarea
          value={reviewerNote}
          onChange={(event) => setReviewerNote(event.target.value)}
          maxLength={4000}
          placeholder="Record the verification evidence, requested correction or suspension reason."
          className="mt-2 min-h-28 w-full rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm text-navy-950 outline-none focus:border-navy-300 focus:ring-2 focus:ring-navy-100"
        />
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        {decisions.map((item) => (
          <button
            key={item.decision}
            type="button"
            disabled={isPending}
            onClick={() => submit(item.decision)}
            className={`min-h-11 rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${item.className}`}
          >
            {isPending ? 'Saving…' : item.label}
          </button>
        ))}
      </div>

      {message ? (
        <p role="status" className={`mt-4 rounded-xl px-3 py-2 text-sm ${isError ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>
          {message}
        </p>
      ) : null}
    </section>
  )
}
