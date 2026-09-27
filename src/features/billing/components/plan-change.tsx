'use client'

import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState, useTransition } from 'react'
import { checkPlanCheckoutAction } from '../actions'
import type { CheckPlanCheckoutResult } from '../checkout-messages'
import { PlanCheckout, type PlanCheckoutProps } from './plan-checkout'

const secondaryButton = 'inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-900 transition hover:border-teal-300 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto'

/**
 * A button that opens the checkout in place, for changes to an existing plan:
 * "Switch to yearly", "Turn auto-renew back on", "Use a different payment method".
 */
export function PlanChangeButton({ label, intro, ...checkout }: PlanCheckoutProps & { label: string; intro: string }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)

  useEffect(() => {
    if (!open && restoreFocus.current) {
      restoreFocus.current = false
      triggerRef.current?.focus()
    }
  }, [open])

  if (!open) {
    return (
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)} aria-expanded={false} className={secondaryButton}>
        {label}
      </button>
    )
  }
  return (
    <section
      aria-label={label}
      onKeyDown={(event) => { if (event.key === 'Escape') { restoreFocus.current = true; setOpen(false) } }}
      className="w-full space-y-3 rounded-2xl border border-teal-200 bg-teal-50/40 p-4"
    >
      <p className="text-sm leading-6 text-navy-800">{intro}</p>
      <PlanCheckout {...checkout} onCancel={() => { restoreFocus.current = true; setOpen(false) }} />
    </section>
  )
}

/** "Check status" for a mandate that is waiting for the customer or their bank. */
export function CheckoutStatusButton({ checkoutId }: { checkoutId: string }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<CheckPlanCheckoutResult | null>(null)

  async function check() {
    setPending(true)
    try {
      const next = await checkPlanCheckoutAction(checkoutId)
      setResult(next)
      if (next.state !== 'waiting' && next.state !== 'unknown') startTransition(() => router.refresh())
    } catch {
      setResult({ state: 'unknown', title: 'We couldn’t check the status yet', message: 'Check your connection and try again in a moment.' })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-2">
      <button type="button" onClick={() => { void check() }} disabled={pending} aria-busy={pending || undefined} className={secondaryButton}>
        <RefreshCw aria-hidden="true" className={`size-4 ${pending ? 'animate-spin' : ''}`} />
        {pending ? 'Checking…' : 'Check status'}
      </button>
      <div aria-live="polite">
        {result ? (
          <p className="text-sm leading-6 text-navy-800"><span className="font-bold">{result.title}.</span> {result.message}</p>
        ) : null}
      </div>
    </div>
  )
}
