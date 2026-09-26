'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ACCESS_ROLE_LABELS } from '@/features/organizations/access-request-labels'
import { COMPANY_ACCESS_REQUEST_ROLES, type CompanyAccessRequestRole } from '@/features/organizations/types'
import { reviewCompanyAccessRequest } from '../actions'

/**
 * Sea N Shore fallback decision controls. Rendered only when the fallback rules
 * allow a platform decision; the server re-checks them on submit.
 */
export function CompanyAccessReviewActions({
  requestId,
  requestedRole = 'member',
}: {
  requestId: string
  requestedRole?: CompanyAccessRequestRole
}) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [role, setRole] = useState<CompanyAccessRequestRole>(requestedRole)
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit(decision: 'approved' | 'rejected') {
    setFeedback(null)
    startTransition(async () => {
      try {
        const result = await reviewCompanyAccessRequest(requestId, decision, note, decision === 'approved' ? role : null)
        if (!result.ok) {
          setFeedback({ ok: false, message: result.error })
          return
        }
        setFeedback({ ok: true, message: decision === 'approved' ? `Approved as ${ACCESS_ROLE_LABELS[role]}.` : 'Request declined.' })
        router.refresh()
      } catch {
        setFeedback({ ok: false, message: 'The decision could not be saved. Check your connection and try again.' })
      }
    })
  }

  return (
    <div className="space-y-3">
      <label className="grid gap-1.5 text-sm font-semibold text-navy-900" htmlFor={`admin-role-${requestId}`}>
        Role to grant
        <select
          id={`admin-role-${requestId}`}
          value={role}
          onChange={(event) => setRole(event.target.value as CompanyAccessRequestRole)}
          className="min-h-10 rounded-xl border border-mist-100 bg-white px-3 text-sm font-normal"
        >
          {COMPANY_ACCESS_REQUEST_ROLES.map((value) => <option key={value} value={value}>{ACCESS_ROLE_LABELS[value]}</option>)}
        </select>
      </label>
      <label className="grid gap-1.5 text-sm font-semibold text-navy-900" htmlFor={`admin-note-${requestId}`}>
        Reviewer note
        <textarea
          id={`admin-note-${requestId}`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={4000}
          placeholder="Required when declining. The requester and the organization see it."
          className="min-h-20 rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm font-normal"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => submit('approved')}
          className="min-h-10 rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-50"
        >
          {isPending ? 'Saving…' : 'Approve access'}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => submit('rejected')}
          className="min-h-10 rounded-xl bg-red-700 px-4 text-sm font-bold text-white disabled:opacity-50"
        >
          Decline
        </button>
      </div>
      {feedback ? (
        <p role={feedback.ok ? 'status' : 'alert'} className={`rounded-lg px-3 py-2 text-sm ${feedback.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800'}`}>
          {feedback.message}
        </p>
      ) : null}
    </div>
  )
}
