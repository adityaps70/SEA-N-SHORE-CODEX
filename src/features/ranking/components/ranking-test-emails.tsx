'use client'

import { useState, useTransition } from 'react'
import { sendTestDigestAction, sendTestJobAlertAction } from '../admin-actions'

/** Admin › Ranking: send yourself a test job alert before the alert emails go to everyone. */
export function RankingTestEmails() {
  const [status, setStatus] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <div className="flex flex-wrap items-center gap-3 p-4">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setStatus(null)
          startTransition(async () => {
            const result = await sendTestJobAlertAction()
            setStatus(result.ok
              ? `Test job alert queued with ${result.jobs ?? 0} job${result.jobs === 1 ? '' : 's'}. It arrives within a minute or two.`
              : result.error)
          })
        }}
        className="inline-flex min-h-11 items-center rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-navy-800 disabled:opacity-60"
      >
        {pending ? 'Queuing…' : 'Send me a test job alert'}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setStatus(null)
          startTransition(async () => {
            const result = await sendTestDigestAction()
            setStatus(result.ok
              ? `Test digest queued with ${result.items ?? 0} item${result.items === 1 ? '' : 's'}. It arrives within a minute or two.`
              : result.error)
          })
        }}
        className="inline-flex min-h-11 items-center rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-950 hover:bg-mist-50 disabled:opacity-60"
      >
        Send me a test digest
      </button>
      <p role="status" className="min-h-5 text-sm text-muted">{status}</p>
    </div>
  )
}
