'use client'

import { useMemo, useState, useTransition } from 'react'
import { Flag, ShieldAlert, X } from 'lucide-react'
import { reportContent } from '../actions'
import {
  REPORT_REASON_LABELS,
  allowedReportReasons,
  type ModerationReportReason,
  type ModerationTargetType,
} from '../types'

export function ReportContentButton({
  targetType,
  targetId,
  label = 'Report',
  iconOnly = false,
  className = '',
}: {
  targetType: ModerationTargetType
  targetId: string
  label?: string
  iconOnly?: boolean
  className?: string
}) {
  const reasons = useMemo(() => allowedReportReasons(targetType), [targetType])
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ModerationReportReason>(reasons[0] ?? 'other')
  const [details, setDetails] = useState('')
  const [status, setStatus] = useState('')
  const [pending, startTransition] = useTransition()

  function close() {
    if (pending) return
    setOpen(false)
    setStatus('')
  }

  return (
    <>
      <button
        type="button"
        aria-label={iconOnly ? label : undefined}
        onClick={() => {
          setReason(reasons[0] ?? 'other')
          setDetails('')
          setStatus('')
          setOpen(true)
        }}
        className={className || (iconOnly
          ? 'inline-flex min-h-10 items-center justify-center rounded-xl px-2 text-muted transition hover:bg-mist-50 hover:text-red-700'
          : 'inline-flex min-h-10 items-center gap-2 rounded-xl border border-mist-100 bg-white px-3.5 text-sm font-semibold text-navy-950 transition hover:border-red-200 hover:bg-red-50 hover:text-red-800')}
      >
        <Flag aria-hidden="true" className="size-4" />
        {iconOnly ? null : label}
      </button>

      {open ? (
        <div className="fixed inset-0 z-[150] grid place-items-center bg-navy-950/45 p-4 backdrop-blur-[2px]">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Report ${targetType}`}
            className="w-full max-w-md rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-2xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-red-700">
                  <ShieldAlert aria-hidden="true" className="size-4" />
                  Safety report
                </p>
                <h2 className="mt-1 text-xl font-bold text-navy-950">Report this {targetType}</h2>
                <p className="mt-1 text-sm leading-6 text-muted">
                  Reports are reviewed by Sea N Shore administrators. Reporting does not automatically remove content.
                </p>
              </div>
              <button type="button" aria-label="Close report form" onClick={close} className="grid size-9 shrink-0 place-items-center rounded-xl text-muted hover:bg-mist-50">
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>

            <label className="mt-5 block text-sm font-semibold text-navy-950">
              Reason
              <select
                aria-label="Reason"
                value={reason}
                onChange={(event) => setReason(event.target.value as ModerationReportReason)}
                className="mt-1.5 min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm text-ink outline-none focus:border-ocean-500"
              >
                {reasons.map((value) => (
                  <option key={value} value={value}>{REPORT_REASON_LABELS[value]}</option>
                ))}
              </select>
            </label>

            <label className="mt-4 block text-sm font-semibold text-navy-950">
              Additional details
              <textarea
                aria-label="Additional details"
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                maxLength={4000}
                rows={4}
                className="mt-1.5 w-full resize-y rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-ocean-500"
                placeholder="Add useful context for the moderation team."
              />
            </label>

            {status ? (
              <p role="status" className={`mt-3 text-sm font-semibold ${status.startsWith('Report submitted') ? 'text-emerald-700' : 'text-red-700'}`}>
                {status}
              </p>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={pending} onClick={close} className="min-h-10 rounded-xl border border-mist-100 px-4 text-sm font-semibold text-navy-950 hover:bg-mist-50 disabled:opacity-60">
                Cancel
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setStatus('')
                  startTransition(async () => {
                    const result = await reportContent({ targetType, targetId, reason, details })
                    if (result.ok) {
                      setStatus('Report submitted for review.')
                      setDetails('')
                    } else {
                      setStatus(result.error)
                    }
                  })
                }}
                className="min-h-10 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-navy-900 disabled:opacity-60"
              >
                {pending ? 'Submitting…' : 'Submit report'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
