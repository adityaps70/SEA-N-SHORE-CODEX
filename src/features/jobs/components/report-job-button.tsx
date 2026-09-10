'use client'

import { useState, useTransition } from 'react'
import { Flag, ShieldAlert } from 'lucide-react'
import { reportJob } from '../actions'

const reasons = [
  ['recruitment_fee', 'Recruitment fee requested'],
  ['fake_company', 'Fake company or recruiter'],
  ['misleading_salary', 'Misleading salary'],
  ['false_vacancy', 'False or expired vacancy'],
  ['suspicious_communication', 'Suspicious communication'],
  ['inappropriate_content', 'Inappropriate content'],
  ['other', 'Other'],
] as const

export function ReportJobButton({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<(typeof reasons)[number][0]>('recruitment_fee')
  const [details, setDetails] = useState('')
  const [status, setStatus] = useState('')
  const [pending, startTransition] = useTransition()

  return (
    <div className="rounded-2xl border border-mist-100 bg-mist-50/60 p-4">
      <button type="button" onClick={() => setOpen((value) => !value)} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-navy-950">
        <Flag aria-hidden="true" className="size-4" /> Report this job
      </button>
      {open ? (
        <div className="mt-3 space-y-3 border-t border-mist-100 pt-3">
          <div className="flex items-start gap-2 text-xs leading-5 text-muted"><ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Reports are reviewed by Sea N Shore. A report does not automatically remove a vacancy.</div>
          <label className="block text-xs font-semibold text-navy-950">Reason
            <select value={reason} onChange={(event) => setReason(event.target.value as typeof reason)} className="mt-1 min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm font-medium text-ink">
              {reasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold text-navy-950">Additional details
            <textarea value={details} onChange={(event) => setDetails(event.target.value)} maxLength={4000} rows={3} className="mt-1 w-full rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm text-ink" placeholder="Tell us what looked suspicious." />
          </label>
          <button type="button" disabled={pending} onClick={() => startTransition(async () => {
            setStatus('')
            const result = await reportJob({ jobId, reason, details })
            if (result.ok) { setStatus('Report submitted for review.'); setDetails('') }
            else setStatus(result.error)
          })} className="inline-flex min-h-10 items-center rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white disabled:opacity-60">
            {pending ? 'Submitting…' : 'Submit report'}
          </button>
          {status ? <p role="status" className="text-xs font-medium text-muted">{status}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
