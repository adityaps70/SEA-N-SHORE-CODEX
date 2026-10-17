'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { closeTicketAsAdmin, reopenTicketAsAdmin } from '../admin-actions'
import type { SupportTicketStatus } from '../topics'
import { supportSecondaryButtonClass } from './form-styles'

/** Round H (H7): Close or Reopen on an admin ticket page; the result is announced. */
export function AdminTicketStatusActions({ ticketId, status }: { ticketId: string; status: SupportTicketStatus }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)
  const closing = status !== 'closed'

  function run() {
    setMessage(null)
    startTransition(async () => {
      const result = closing ? await closeTicketAsAdmin(ticketId) : await reopenTicketAsAdmin(ticketId)
      if (!result.ok) {
        setMessage({ tone: 'error', text: result.error })
        return
      }
      setMessage({ tone: 'success', text: closing ? 'Request closed.' : 'Request reopened.' })
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={run} disabled={pending} className={supportSecondaryButtonClass}>
        {pending ? (closing ? 'Closing…' : 'Reopening…') : closing ? 'Close request' : 'Reopen request'}
      </button>
      <p role="status" aria-live="polite" className={message?.tone === 'error' ? 'text-sm text-red-700' : 'text-sm text-emerald-800'}>
        {message?.text ?? ''}
      </p>
    </div>
  )
}
