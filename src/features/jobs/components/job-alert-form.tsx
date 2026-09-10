'use client'

import { useState, useTransition } from 'react'
import { BellRing, Trash2 } from 'lucide-react'
import { createJobAlert, deleteJobAlert } from '../actions'

export function JobAlertForm({ queryString = 'mode=for-you' }: { queryString?: string }) {
  const [name, setName] = useState('')
  const [frequency, setFrequency] = useState<'instant' | 'daily' | 'weekly'>('daily')
  const [message, setMessage] = useState('')
  const [pending, startTransition] = useTransition()

  return (
    <div className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
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
        })} className="min-h-11 rounded-xl bg-navy-950 px-5 text-sm font-semibold text-white disabled:opacity-50">{pending ? 'Creating…' : 'Create alert'}</button>
      </div>
      {message ? <p role="status" className="mt-3 text-xs font-medium text-muted">{message}</p> : null}
    </div>
  )
}

export function DeleteJobAlertButton({ alertId }: { alertId: string }) {
  const [pending, startTransition] = useTransition()
  return <button type="button" disabled={pending} onClick={() => startTransition(() => deleteJobAlert(alertId).then(() => undefined))} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-muted hover:bg-mist-50 hover:text-red-700 disabled:opacity-50"><Trash2 aria-hidden="true" className="size-3.5" />{pending ? 'Removing…' : 'Delete'}</button>
}
