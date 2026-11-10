'use client'

import { useState, useTransition } from 'react'
import {
  cancelPreparedLegacyFinalReminders,
  prepareLegacyFinalReminderBatch,
  resumeLegacyFinalReminders,
  sendLegacyFinalReminderTest,
  startPreparedLegacyFinalReminders,
  stopUnsentLegacyFinalReminders,
} from '@/features/legacy-invites/final-reminder-admin-actions'
import type { FinalPrepareResult } from '@/features/legacy-invites/final-reminder-repository'
import type { LegacyReminderTestResult } from '@/features/legacy-invites/reminder-test'
import { buttonClass } from '@/components/ui/interactive-styles'
import { pluralize } from '@/lib/format'

function when(value: string | null) {
  return value ? new Date(value).toLocaleString('en-IN') : 'later'
}

function prepareMessage(result: FinalPrepareResult) {
  if (result.status === 'paused') return 'Nothing was prepared: final reminders are paused.'
  if (result.status === 'first_batch_gate') {
    return `Nothing was prepared: the first batch of 100 must finish sending and 24 hours must pass since its last send (from ${when(result.opensAt)}).`
  }
  const prepared = pluralize(result.prepared, 'final reminder')
  return result.limitedByFirstBatch
    ? `${prepared} prepared. Only the rest of the first batch of 100 can be prepared for now.`
    : `${prepared} prepared.`
}

/** Prepare → review → Start sending → Stop for the final reminder, and Resume after an auto-pause. */
export function LegacyFinalReminderControls(props: {
  prepared: number
  queued: number
  sending: number
  paused: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  function run<T>(action: () => Promise<T>, describe: (result: T) => string, confirmation?: string) {
    if (confirmation && !window.confirm(confirmation)) return
    setMessage(null)
    startTransition(async () => {
      try {
        const result = await action()
        const text = describe(result)
        setMessage(text)
        // A refusal stays on screen; anything that changed reloads the counts.
        if (!/^(Nothing|Not) /.test(text)) window.location.reload()
      } catch {
        setMessage('The action failed. Nothing else was changed.')
      }
    })
  }

  return (
    <div className="space-y-4">
      {props.paused ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Final reminders are paused. Nothing is sent, prepared or started until an administrator resumes.</p>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(
              resumeLegacyFinalReminders,
              (result) => result.status === 'step_up_required'
                ? 'Not resumed: confirm your password and authenticator code first (Settings → Two-step verification), then press Resume again.'
                : result.status === 'resumed' ? 'Final reminders resumed.' : 'Not resumed: final reminders were not paused.',
              'Resume sending final reminders? Check the bounce and complaint rates first.',
            )}
            className={buttonClass({ variant: 'primary', size: 'sm' })}
          >
            Resume
          </button>
        </div>
      ) : null}

      <div>
        <p className="text-sm font-semibold text-navy-950">1. Prepare recipients — this does not send email</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {[10, 50, 100].map((limit) => (
            <button
              key={limit}
              type="button"
              disabled={pending || props.paused}
              onClick={() => run(() => prepareLegacyFinalReminderBatch(limit), prepareMessage)}
              className="min-h-10 rounded-xl border border-ocean-200 bg-ocean-50 px-4 text-sm font-bold text-ocean-800 transition hover:bg-ocean-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Prepare {limit}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-mist-100 pt-4">
        <button
          type="button"
          disabled={pending || props.paused || props.prepared === 0}
          onClick={() => run(
            startPreparedLegacyFinalReminders,
            (result) => result.status === 'paused' ? 'Not started: final reminders are paused.' : 'Prepared final reminders moved to the send queue.',
            `Start sending ${pluralize(props.prepared, 'prepared final reminder')}? Once a message is handed to Resend it cannot be recalled.`,
          )}
          className={buttonClass({ variant: 'primary', size: 'sm' })}
        >
          Start sending {props.prepared > 0 ? props.prepared : ''}
        </button>

        <button
          type="button"
          disabled={pending || props.prepared === 0}
          onClick={() => run(
            cancelPreparedLegacyFinalReminders,
            () => 'Prepared final reminders cancelled.',
            `Cancel all ${pluralize(props.prepared, 'prepared final reminder')}? No email will be sent to them.`,
          )}
          className="min-h-10 rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-900 transition hover:bg-mist-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Cancel prepared
        </button>

        <button
          type="button"
          disabled={pending || props.queued === 0}
          onClick={() => run(
            stopUnsentLegacyFinalReminders,
            () => 'Remaining queued final reminders stopped.',
            `Stop ${pluralize(props.queued, 'queued final reminder')}? Messages already in Sending or already accepted by Resend cannot be recalled.`,
          )}
          className="min-h-10 rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-bold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Stop unsent {props.queued > 0 ? props.queued : ''}
        </button>
      </div>

      {props.sending > 0 ? (
        <p className="text-xs font-semibold text-amber-700">
          {props.sending === 1 ? '1 message is' : `${props.sending} messages are`} currently being processed. {props.sending === 1 ? 'It' : 'Those'} may already be with Resend and cannot be guaranteed cancellable.
        </p>
      ) : null}
      {message ? <p className="text-xs text-muted">{message}</p> : null}
    </div>
  )
}

const TEST_MESSAGES: Record<LegacyReminderTestResult['status'], (to: string) => string> = {
  sent: (to) => `Test sent to ${to}. It is not a final reminder and changes nothing.`,
  no_verified_email: () => 'No test was sent: your sign-in email is not verified.',
  rate_limited: () => 'No test was sent: you have sent 5 tests in the last hour. Try again later.',
  unavailable: () => 'No test was sent: email sending is not configured.',
  failed: (to) => `Resend did not accept the test to ${to}. The attempt is in the audit log.`,
}

/** "Send test to me" for the final reminder: the exact email, with sample details, to the admin's own verified email. */
export function LegacyFinalReminderTestButton() {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  function send() {
    setMessage(null)
    startTransition(async () => {
      try {
        const result = await sendLegacyFinalReminderTest()
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
        {message ?? 'Sends this exact email, with sample details and live counts, to your own verified sign-in email. Up to 5 an hour.'}
      </p>
    </div>
  )
}
