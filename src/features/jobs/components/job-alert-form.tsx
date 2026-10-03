'use client'

import { useState, useTransition } from 'react'
import { BellRing, Trash2 } from 'lucide-react'
import { BottomSheet } from '@/components/ui/mobile-sheet'
import { createJobAlert, deleteJobAlert } from '../actions'
import { SheetPortal } from './sheet-portal'

export function JobAlertForm({ queryString = 'mode=for-you', plain = false }: { queryString?: string; plain?: boolean }) {
  const [name, setName] = useState('')
  const [frequency, setFrequency] = useState<'instant' | 'daily' | 'weekly'>('daily')
  const [message, setMessage] = useState('')
  const [pending, startTransition] = useTransition()

  return (
    <div className={plain ? 'px-3 py-2' : 'rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6'}>
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-navy-950 text-white"><BellRing aria-hidden="true" className="size-4.5" /></div>
        <div><h2 className="font-semibold text-navy-950">Create an alert</h2><p className="mt-1 text-sm leading-6 text-muted">Save this search and choose how often Sea N Shore should surface matching maritime opportunities.</p></div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
        <label className="text-xs font-semibold text-navy-950">Alert name
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="Chief Officer tanker jobs" className="mt-1 min-h-11 w-full rounded-xl border border-mist-100 bg-mist-50 px-3 text-sm text-ink outline-none focus:border-ocean-700 focus:bg-white" />
        </label>
        <label className="text-xs font-semibold text-navy-950">Frequency
          <select value={frequency} onChange={(event) => setFrequency(event.target.value as typeof frequency)} className="mt-1 min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm font-medium text-ink">
            <option value="instant">Instant</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
          </select>
        </label>
        <button type="button" disabled={pending || name.trim().length < 2} onClick={() => startTransition(async () => {
          setMessage('')
          const result = await createJobAlert({ name, queryString, frequency })
          if (result.ok) { setMessage('Alert created.'); setName('') } else setMessage(result.error)
        })} className="min-h-11 rounded-xl bg-navy-950 px-5 text-sm font-semibold text-white disabled:opacity-50 enabled:hover:bg-navy-800 transition-colors disabled:cursor-not-allowed">{pending ? 'Creating…' : 'Create alert'}</button>
      </div>
      {message ? <p role="status" className="mt-3 text-xs font-medium text-muted">{message}</p> : null}
    </div>
  )
}

export function DeleteJobAlertButton({ alertId }: { alertId: string }) {
  const [pending, startTransition] = useTransition()
  return <button type="button" disabled={pending} onClick={() => startTransition(() => deleteJobAlert(alertId).then(() => undefined))} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-mist-200 bg-white px-2.5 text-xs font-semibold text-navy-900 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"><Trash2 aria-hidden="true" className="size-3.5" />{pending ? 'Removing…' : 'Delete'}</button>
}

/** Phone entry for creating an alert (round 8): a button that opens the form in a bottom sheet. */
export function CreateJobAlertSheet({ queryString = 'mode=for-you' }: { queryString?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-ocean-700 px-5 text-[15px] font-semibold text-white hover:bg-ocean-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500"
      >
        <BellRing aria-hidden="true" className="size-4" />
        Create alert
      </button>
      <SheetPortal>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Create alert" desktop="hidden">
        <JobAlertForm queryString={queryString} plain />
      </BottomSheet>
      </SheetPortal>
    </div>
  )
}
