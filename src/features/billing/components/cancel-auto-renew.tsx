'use client'

import { useRouter } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'
import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { cancelAutoRenewAction } from '../actions'
import type { PlanCheckoutTarget } from '../checkout-messages'

/**
 * "Cancel auto-renew" with the confirmation built into the page (no window.confirm).
 * Escape or "Keep auto-renew" closes it and returns focus to the button.
 */
export function CancelAutoRenewButton({ target, planLabel, accessUntil }: {
  target: PlanCheckoutTarget
  planLabel: string
  /** Last day of the paid period, e.g. "12 Oct 2026". */
  accessUntil: string | null
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const keepRef = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  const titleId = useId()

  useEffect(() => {
    if (open) {
      keepRef.current?.focus()
    } else if (restoreFocus.current) {
      restoreFocus.current = false
      triggerRef.current?.focus()
    }
  }, [open])

  function close() {
    if (pending) return
    restoreFocus.current = true
    setOpen(false)
    setError(null)
  }

  async function confirm() {
    setPending(true)
    setError(null)
    try {
      const result = await cancelAutoRenewAction({ target })
      if (result.ok) {
        setDone(result.message)
        setOpen(false)
        startTransition(() => router.refresh())
      } else {
        setError(result.error)
      }
    } catch {
      setError('We couldn’t reach Sea N Shore. Auto-renew is still on. Check your connection and try again.')
    } finally {
      setPending(false)
    }
  }

  if (done) {
    return (
      <p role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
        <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {done}
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {!open ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-xl border border-rose-200 bg-white px-4 text-sm font-bold text-rose-700 transition hover:border-rose-300 hover:bg-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 sm:w-auto"
        >
          Cancel auto-renew
        </button>
      ) : (
        <section
          role="group"
          aria-labelledby={titleId}
          onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}
          className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50/60 p-4"
        >
          <h3 id={titleId} className="text-sm font-bold text-navy-950">Turn off auto-renew?</h3>
          <p className="text-sm leading-6 text-navy-800">
            {accessUntil
              ? `You won’t be charged again. ${planLabel} stays active until ${accessUntil}, then your account moves to the free plan.`
              : `You won’t be charged again, and ${planLabel} ends now because no paid period is left.`}
            {accessUntil ? ' You can turn auto-renew back on before then.' : null}
          </p>
          {error ? <p className="text-sm font-medium text-rose-700" role="alert">{error}</p> : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              ref={keepRef}
              type="button"
              onClick={close}
              disabled={pending}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-900 transition hover:border-teal-300 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Keep auto-renew
            </button>
            <button
              type="button"
              onClick={() => { void confirm() }}
              disabled={pending}
              aria-busy={pending || undefined}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-rose-700 px-4 text-sm font-bold text-white transition hover:bg-rose-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? 'Turning off…' : 'Turn off auto-renew'}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
