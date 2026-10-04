'use client'

import { RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { secondaryButtonClass } from '@/components/ui/interactive-styles'
import { cancelPayoutAction, refreshPayoutStatusAction, retryPayoutAction, type PayoutActionResult } from '../../admin-actions'

type Props = {
  payoutId: string
  status: 'draft' | 'processing' | 'success' | 'failed' | 'reversed' | 'cancelled'
  amountLabel: string
  /** Compact buttons for queue rows. */
  compact?: boolean
}

type Command = 'refresh' | 'retry' | 'cancel'

/**
 * Admin controls for one payout: Check status (asks Cashfree), and for a payout
 * Cashfree never confirmed: Send again (same transfer id) or Cancel (in-page confirmation).
 */
export function PayoutStatusActions({ payoutId, status, amountLabel, compact = false }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [pending, setPending] = useState<Command | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [result, setResult] = useState<PayoutActionResult | null>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelOpenRef = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)
  const titleId = useId()

  useEffect(() => {
    if (confirmCancel) confirmRef.current?.focus()
    else if (refocus.current) {
      refocus.current = false
      cancelOpenRef.current?.focus()
    }
  }, [confirmCancel])

  async function run(command: Command) {
    if (pending) return
    setPending(command)
    setResult(null)
    let outcome: PayoutActionResult
    try {
      outcome = command === 'refresh'
        ? await refreshPayoutStatusAction(payoutId)
        : command === 'retry'
          ? await retryPayoutAction(payoutId)
          : await cancelPayoutAction(payoutId)
    } catch {
      outcome = { ok: false, error: "We couldn't reach Sea N Shore. Nothing was changed. Check your connection and try again." }
    }
    setPending(null)
    setResult(outcome)
    if (outcome.ok) {
      setConfirmCancel(false)
      startTransition(() => router.refresh())
    }
  }

  const buttonClass = `${secondaryButtonClass} ${compact ? 'min-h-9 px-3 text-xs' : ''}`.trim()
  const canCheck = status === 'draft' || status === 'processing' || status === 'success'
  const unconfirmed = status === 'draft'

  return (
    <div className="space-y-2">
      <div className={`flex flex-wrap gap-2 ${compact ? 'sm:justify-end' : ''}`}>
        {canCheck ? (
          <button type="button" onClick={() => { void run('refresh') }} disabled={Boolean(pending)} aria-busy={pending === 'refresh' || undefined} className={buttonClass}>
            <RefreshCw aria-hidden="true" className={`size-3.5 ${pending === 'refresh' ? 'motion-safe:animate-spin' : ''}`} />
            {pending === 'refresh' ? 'Checking…' : 'Check status'}
          </button>
        ) : null}
        {unconfirmed && !confirmCancel ? (
          <>
            <button type="button" onClick={() => { void run('retry') }} disabled={Boolean(pending)} aria-busy={pending === 'retry' || undefined} className={buttonClass}>
              {pending === 'retry' ? 'Sending…' : 'Send again'}
            </button>
            <button ref={cancelOpenRef} type="button" onClick={() => { setResult(null); setConfirmCancel(true) }} disabled={Boolean(pending)} className={`${buttonClass} hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800`}>
              Cancel payout
            </button>
          </>
        ) : null}
      </div>
      {confirmCancel ? (
        <div role="group" aria-labelledby={titleId} onKeyDown={(event) => { if (event.key === 'Escape' && !pending) { refocus.current = true; setConfirmCancel(false) } }} className="space-y-2 rounded-lg border border-rose-200 bg-rose-50/60 p-3 text-left">
          <p id={titleId} className="text-sm font-semibold text-navy-950">Cancel this {amountLabel} payout?</p>
          <p className="text-xs leading-5 text-navy-800">We first ask Cashfree whether it received the transfer. If it did, the payout follows Cashfree instead. If not, it is cancelled and the earnings go back to the seller&apos;s available balance.</p>
          <div className="flex flex-wrap gap-2">
            <button ref={confirmRef} type="button" onClick={() => { void run('cancel') }} disabled={Boolean(pending)} aria-busy={pending === 'cancel' || undefined} className="inline-flex min-h-9 cursor-pointer items-center rounded-lg bg-rose-700 px-3 text-xs font-bold text-white transition hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-60">
              {pending === 'cancel' ? 'Cancelling…' : 'Yes, cancel payout'}
            </button>
            <button type="button" onClick={() => { refocus.current = true; setConfirmCancel(false) }} disabled={Boolean(pending)} className="inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-mist-200 bg-white px-3 text-xs font-bold text-navy-900 transition hover:bg-mist-50 disabled:cursor-not-allowed disabled:opacity-60">
              Keep payout
            </button>
          </div>
        </div>
      ) : null}
      {result ? (
        <p role={result.ok ? 'status' : 'alert'} className={`text-xs font-medium leading-5 ${result.ok ? 'text-navy-800' : 'text-red-700'} ${compact ? 'sm:max-w-xs sm:text-right' : ''}`}>
          {result.ok ? result.message : result.error}
        </p>
      ) : null}
    </div>
  )
}
