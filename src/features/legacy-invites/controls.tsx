'use client'

import { useState, useTransition } from 'react'
import {
  cancelPreparedLegacyInvites,
  cancelPreparedLegacyReminders,
  prepareLegacyInviteBatch,
  prepareLegacyReminderBatch,
  sendLegacyReminderTest,
  startPreparedLegacyInvites,
  startPreparedLegacyReminders,
  stopUnsentLegacyInvites,
  stopUnsentLegacyReminders,
} from '@/features/legacy-invites/admin-actions'
import type { LegacyReminderTestResult } from '@/features/legacy-invites/reminder-test'
import { buttonClass } from '@/components/ui/interactive-styles'

const MODES = {
  invite: {
    noun: 'legacy invitation',
    prepare: prepareLegacyInviteBatch,
    start: startPreparedLegacyInvites,
    cancel: cancelPreparedLegacyInvites,
    stop: stopUnsentLegacyInvites,
  },
  reminder: {
    noun: 'second reminder',
    prepare: prepareLegacyReminderBatch,
    start: startPreparedLegacyReminders,
    cancel: cancelPreparedLegacyReminders,
    stop: stopUnsentLegacyReminders,
  },
} as const

export function LegacyInviteControls(props: {
  mode?: keyof typeof MODES
  prepared: number
  queued: number
  failed: number
  sending: number
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const mode = MODES[props.mode ?? 'invite']
  // A failed second reminder is final (never retried), so only queued ones can be stopped.
  const unsent = props.queued + (props.mode === 'reminder' ? 0 : props.failed)

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
            <form key={limit} action={mode.prepare}>
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
            mode.start,
            `Start sending ${props.prepared} prepared ${mode.noun}(s)? Once a message is handed to Resend it cannot be recalled.`,
            `Prepared ${mode.noun}s moved to the send queue.`,
          )}
          className={buttonClass({ variant: 'primary', size: 'sm' })}
        >
          Start sending {props.prepared > 0 ? props.prepared : ''}
        </button>

        <button
          type="button"
          disabled={pending || props.prepared === 0}
          onClick={() => run(
            mode.cancel,
            `Cancel all ${props.prepared} prepared ${mode.noun}(s)? No email will be sent to them.`,
            `Prepared ${mode.noun}s cancelled.`,
          )}
          className="min-h-10 rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-900 transition hover:bg-mist-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Cancel prepared
        </button>

        <button
          type="button"
          disabled={pending || unsent === 0}
          onClick={() => run(
            mode.stop,
            `Stop ${unsent} queued/retry ${mode.noun}(s)? Messages already in Sending or already accepted by Resend cannot be recalled.`,
            `Remaining queued/retry ${mode.noun}s stopped.`,
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

const TEST_MESSAGES: Record<LegacyReminderTestResult['status'], (to: string) => string> = {
  sent: (to) => `Test sent to ${to}. It is not a reminder and changes nothing.`,
  no_verified_email: () => 'No test was sent: your sign-in email is not verified.',
  rate_limited: () => 'No test was sent: you have sent 5 tests in the last hour. Try again later.',
  unavailable: () => 'No test was sent: email sending is not configured.',
  failed: (to) => `Resend did not accept the test to ${to}. The attempt is in the audit log.`,
}

/** "Send test to me": the exact reminder, with sample details, to the signed-in admin's own verified email only. */
export function LegacyReminderTestButton() {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  function send() {
    setMessage(null)
    startTransition(async () => {
      try {
        const result = await sendLegacyReminderTest()
        setMessage(TEST_MESSAGES[result.status]('to' in result ? result.to : ''))
      } catch {
        setMessage('No test was sent: the request failed.')
      }
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={send}
        className="min-h-10 rounded-xl border border-ocean-200 bg-white px-4 text-sm font-bold text-ocean-800 transition hover:bg-ocean-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? 'Sending test…' : 'Send test to me'}
      </button>
      <p className="text-xs leading-5 text-muted">
        {message ?? 'Sends this exact email, with sample details, to your own verified sign-in email. Up to 5 an hour.'}
      </p>
    </div>
  )
}
