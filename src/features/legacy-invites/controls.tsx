'use client'

import { useState, useTransition } from 'react'
import {
  cancelPreparedLegacyInvites,
  prepareLegacyInviteBatch,
  startPreparedLegacyInvites,
  stopUnsentLegacyInvites,
} from '@/features/legacy-invites/admin-actions'

export function LegacyInviteControls(props: {
  prepared: number
  queued: number
  failed: number
  sending: number
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const unsent = props.queued + props.failed

  function run(action: () => Promise<void>, confirmation: string, success: string) {
    if (!window.confirm(confirmation)) return
    setMessage(null)
    startTransition(async () => {
      try {
        await action()
        setMessage(success)
        window.location.reload()
      } catch {
        setMessage('The action failed. Nothing else was changed.')
      }
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-navy-950">1. Prepare recipients — this does not send email</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {[10, 50, 100].map((limit) => (
            <form key={limit} action={prepareLegacyInviteBatch}>
              <input type="hidden" name="limit" value={limit} />
              <button
                type="submit"
                disabled={pending}
                className="min-h-10 rounded-xl border border-ocean-200 bg-ocean-50 px-4 text-sm font-bold text-ocean-800 transition hover:bg-ocean-100 disabled:opacity-50"
              >
                Prepare {limit}
              </button>
            </form>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-mist-100 pt-4">
        <button
          type="button"
          disabled={pending || props.prepared === 0}
          onClick={() => run(
            startPreparedLegacyInvites,
            `Start sending ${props.prepared} prepared legacy invitation(s)? Once a message is handed to Resend it cannot be recalled.`,
            'Prepared invitations moved to the send queue.',
          )}
          className="min-h-10 rounded-xl bg-ocean-700 px-4 text-sm font-bold text-white transition hover:bg-ocean-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Start sending {props.prepared > 0 ? props.prepared : ''}
        </button>

        <button
          type="button"
          disabled={pending || props.prepared === 0}
          onClick={() => run(
            cancelPreparedLegacyInvites,
            `Cancel all ${props.prepared} prepared invitation(s)? No email will be sent to them.`,
            'Prepared invitations cancelled.',
          )}
          className="min-h-10 rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-900 transition hover:bg-mist-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Cancel prepared
        </button>

        <button
          type="button"
          disabled={pending || unsent === 0}
          onClick={() => run(
            stopUnsentLegacyInvites,
            `Stop ${unsent} queued/retry invitation(s)? Messages already in Sending or already accepted by Resend cannot be recalled.`,
            'Remaining queued/retry invitations stopped.',
          )}
          className="min-h-10 rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-bold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Stop unsent {unsent > 0 ? unsent : ''}
        </button>
      </div>

      {props.sending > 0 ? (
        <p className="text-xs font-semibold text-amber-700">
          {props.sending} message(s) are currently being processed. Those may already be with Resend and cannot be guaranteed cancellable.
        </p>
      ) : null}
      {message ? <p className="text-xs text-muted">{message}</p> : null}
    </div>
  )
}
