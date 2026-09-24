'use client'

import { useState, useTransition } from 'react'
import { reviewCompanyAccessRequest } from '../actions'

export function CompanyAccessReviewActions({ requestId }: { requestId: string }) {
  const [note, setNote] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit(decision: 'approved' | 'rejected') {
    setFeedback(null)
    startTransition(async () => {
      const result = await reviewCompanyAccessRequest(requestId, decision, note)
      setFeedback(result.ok
        ? decision === 'approved'
          ? 'Access request approved.'
          : 'Access request rejected.'
        : result.error)
    })
  }

  return (
    <div className="space-y-3">
      <label className="grid gap-1.5 text-sm font-semibold text-navy-900">
        Review note
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={4000}
          placeholder="Required when rejecting; optional when approving."
          className="min-h-20 rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => submit('approved')}
          className="min-h-10 rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-50"
        >
          Approve access
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => submit('rejected')}
          className="min-h-10 rounded-xl bg-red-700 px-4 text-sm font-bold text-white disabled:opacity-50"
        >
          Reject
        </button>
      </div>
      {feedback ? <p role="status" className="text-sm text-muted">{feedback}</p> : null}
    </div>
  )
}
