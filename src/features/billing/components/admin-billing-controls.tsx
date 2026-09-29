'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { adminCancelSubscriptionAction, adminEndTrialAction, adminExtendTrialAction, updatePlanPriceAction } from '../admin-actions'

const secondaryButton = 'inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-mist-200 bg-white px-3 text-sm font-semibold text-navy-900 transition hover:border-ocean-300 hover:bg-ocean-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-700 disabled:cursor-not-allowed disabled:opacity-60'
const primaryButton = 'inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg bg-navy-950 px-3 text-sm font-semibold text-white transition hover:bg-navy-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950 disabled:cursor-not-allowed disabled:opacity-60'
const dangerButton = 'inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg bg-red-700 px-3 text-sm font-semibold text-white transition hover:bg-red-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-60'

function useFocusReturn(open: boolean) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const firstRef = useRef<HTMLElement | null>(null)
  const restoreRef = useRef(false)
  useEffect(() => {
    if (open) firstRef.current?.focus()
    else if (restoreRef.current) {
      restoreRef.current = false
      triggerRef.current?.focus()
    }
  }, [open])
  return { triggerRef, firstRef, restoreRef }
}

/** Change the price new subscribers pay. Saves a new price row; existing subscribers keep theirs. */
export function PlanPriceEditor({ plan, interval, label, currentRupees }: { plan: string; interval: string; label: string; currentRupees: string }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(currentRupees)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const { triggerRef, firstRef, restoreRef } = useFocusReturn(open)
  const inputId = useId()

  function close() {
    restoreRef.current = true
    setOpen(false)
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setMessage(null)
    try {
      const result = await updatePlanPriceAction({ plan, interval, amount })
      if (result.ok) {
        setMessage({ tone: 'ok', text: result.message })
        close()
        startTransition(() => router.refresh())
      } else {
        setMessage({ tone: 'error', text: result.error })
      }
    } catch {
      setMessage({ tone: 'error', text: 'The price could not be saved. Check your connection and try again.' })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-2">
      {open ? (
        <form onSubmit={save} onKeyDown={(event) => { if (event.key === 'Escape' && !pending) close() }} className="flex flex-col gap-2 sm:flex-row sm:items-end" noValidate>
          <div className="space-y-1">
            <label htmlFor={inputId} className="text-xs font-semibold text-navy-900">New {label} price (₹)</label>
            <input
              ref={(node) => { firstRef.current = node }}
              id={inputId}
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="min-h-10 w-full rounded-lg border border-mist-200 bg-white px-3 text-sm text-navy-950 outline-none focus:border-ocean-500 focus-visible:ring-2 focus-visible:ring-ocean-500/30 sm:w-36"
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} aria-busy={pending || undefined} className={primaryButton}>{pending ? 'Saving…' : 'Save price'}</button>
            <button type="button" onClick={close} disabled={pending} className={secondaryButton}>Cancel</button>
          </div>
        </form>
      ) : (
        <button ref={triggerRef} type="button" onClick={() => { setAmount(currentRupees); setOpen(true); setMessage(null) }} className={secondaryButton}>
          Change price
        </button>
      )}
      <div aria-live="polite">
        {message ? <p className={`text-sm ${message.tone === 'ok' ? 'text-emerald-800' : 'font-medium text-red-700'}`}>{message.text}</p> : null}
      </div>
    </div>
  )
}

/** Cancel a subscription from the admin list: stop auto-renew, or end access now. */
export function AdminCancelSubscription({ accessId, subjectName, planLabel, accessUntil }: { accessId: string; subjectName: string; planLabel: string; accessUntil: string | null }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<'period_end' | 'now' | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const { triggerRef, firstRef, restoreRef } = useFocusReturn(open)
  const titleId = useId()

  function close() {
    if (pending) return
    restoreRef.current = true
    setOpen(false)
  }

  async function run(mode: 'period_end' | 'now') {
    setPending(mode)
    setMessage(null)
    try {
      const result = await adminCancelSubscriptionAction({ accessId, mode })
      if (result.ok) {
        setMessage({ tone: 'ok', text: result.message })
        setOpen(false)
        startTransition(() => router.refresh())
      } else {
        setMessage({ tone: 'error', text: result.error })
      }
    } catch {
      setMessage({ tone: 'error', text: 'The subscription could not be cancelled. Check your connection and try again.' })
    } finally {
      setPending(null)
    }
  }

  if (message?.tone === 'ok') return <p role="status" className="text-sm text-emerald-800">{message.text}</p>

  return (
    <div className="space-y-2">
      {open ? (
        <section role="group" aria-labelledby={titleId} onKeyDown={(event) => { if (event.key === 'Escape') close() }} className="space-y-2 rounded-lg border border-red-200 bg-red-50/60 p-3">
          <p id={titleId} className="text-sm font-semibold text-navy-950">Cancel {planLabel} for {subjectName}?</p>
          <p className="text-xs leading-5 text-navy-800">Stopping auto-renew keeps access{accessUntil ? ` until ${accessUntil}` : ' until the paid period ends'}. Ending now removes access immediately and gives no refund here — refund in the Cashfree dashboard if needed.</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button ref={(node) => { firstRef.current = node }} type="button" onClick={close} disabled={Boolean(pending)} className={secondaryButton}>Keep it</button>
            <button type="button" onClick={() => { void run('period_end') }} disabled={Boolean(pending)} aria-busy={pending === 'period_end' || undefined} className={primaryButton}>
              {pending === 'period_end' ? 'Stopping…' : 'Stop auto-renew'}
            </button>
            <button type="button" onClick={() => { void run('now') }} disabled={Boolean(pending)} aria-busy={pending === 'now' || undefined} className={dangerButton}>
              {pending === 'now' ? 'Ending…' : 'End access now'}
            </button>
          </div>
        </section>
      ) : (
        <button ref={triggerRef} type="button" onClick={() => setOpen(true)} className={secondaryButton}>Cancel…</button>
      )}
      <div aria-live="polite">{message?.tone === 'error' ? <p className="text-sm font-medium text-red-700">{message.text}</p> : null}</div>
    </div>
  )
}

/** Extend a running free trial by a number of days, or end it now. */
export function AdminTrialControls({ trialId, subjectName, planLabel, endsOn }: { trialId: string; subjectName: string; planLabel: string; endsOn: string | null }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [mode, setMode] = useState<'closed' | 'extend' | 'end'>('closed')
  const [days, setDays] = useState('14')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const { triggerRef, firstRef, restoreRef } = useFocusReturn(mode !== 'closed')
  const inputId = useId()

  function close() {
    if (pending) return
    restoreRef.current = true
    setMode('closed')
  }

  async function run(action: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) {
    setPending(true)
    setMessage(null)
    try {
      const result = await action()
      if (result.ok) {
        setMessage({ tone: 'ok', text: result.message })
        setMode('closed')
        startTransition(() => router.refresh())
      } else {
        setMessage({ tone: 'error', text: result.error })
      }
    } catch {
      setMessage({ tone: 'error', text: 'The trial could not be changed. Check your connection and try again.' })
    } finally {
      setPending(false)
    }
  }

  if (message?.tone === 'ok') return <p role="status" className="text-sm text-emerald-800">{message.text}</p>

  return (
    <div className="space-y-2">
      {mode === 'extend' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const parsed = Number.parseInt(days, 10)
            void run(() => adminExtendTrialAction({ trialId, days: Number.isFinite(parsed) ? parsed : 0 }))
          }}
          onKeyDown={(event) => { if (event.key === 'Escape') close() }}
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          noValidate
        >
          <div className="space-y-1">
            <label htmlFor={inputId} className="text-xs font-semibold text-navy-900">Add days to the {planLabel} trial of {subjectName}</label>
            <input
              ref={(node) => { firstRef.current = node }}
              id={inputId}
              inputMode="numeric"
              value={days}
              onChange={(event) => setDays(event.target.value)}
              className="min-h-10 w-full rounded-lg border border-mist-200 bg-white px-3 text-sm text-navy-950 outline-none focus:border-ocean-500 focus-visible:ring-2 focus-visible:ring-ocean-500/30 sm:w-28"
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} aria-busy={pending || undefined} className={primaryButton}>{pending ? 'Saving…' : 'Extend trial'}</button>
            <button type="button" onClick={close} disabled={pending} className={secondaryButton}>Cancel</button>
          </div>
        </form>
      ) : mode === 'end' ? (
        <section role="group" aria-label={`End the ${planLabel} trial of ${subjectName}?`} onKeyDown={(event) => { if (event.key === 'Escape') close() }} className="space-y-2 rounded-lg border border-red-200 bg-red-50/60 p-3">
          <p className="text-sm font-semibold text-navy-950">End the {planLabel} trial of {subjectName} now?</p>
          <p className="text-xs leading-5 text-navy-800">The account returns to the free plan immediately{endsOn ? ` instead of on ${endsOn}` : ''}. Nothing is deleted; Pro-only content becomes locked.</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button ref={(node) => { firstRef.current = node }} type="button" onClick={close} disabled={pending} className={secondaryButton}>Keep it</button>
            <button type="button" onClick={() => { void run(() => adminEndTrialAction({ trialId })) }} disabled={pending} aria-busy={pending || undefined} className={dangerButton}>
              {pending ? 'Ending…' : 'End trial now'}
            </button>
          </div>
        </section>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button ref={triggerRef} type="button" onClick={() => { setMode('extend'); setMessage(null) }} className={secondaryButton}>Extend…</button>
          <button type="button" onClick={() => { setMode('end'); setMessage(null) }} className={secondaryButton}>End trial…</button>
        </div>
      )}
      <div aria-live="polite">{message?.tone === 'error' ? <p className="text-sm font-medium text-red-700">{message.text}</p> : null}</div>
    </div>
  )
}
