'use client'

import Link from 'next/link'
import { Send } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { primaryButtonClass, secondaryButtonClass, textLinkClass } from '@/components/ui/interactive-styles'
import { sendPayoutAction, type PayoutActionResult } from '../../admin-actions'

type Props = {
  sellerKey: string
  sellerName: string
  earningIds: string[]
  totalMinor: number
  amountLabel: string
  accountSummary: string
}

const toneByState: Record<string, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  processing: 'border-ocean-200 bg-ocean-50 text-ocean-900',
  sending: 'border-ocean-200 bg-ocean-50 text-ocean-900',
  failed: 'border-red-200 bg-red-50 text-red-800',
  reversed: 'border-red-200 bg-red-50 text-red-800',
}

/** Admin review screen: "Send ₹X via Cashfree" with an in-page confirmation step. */
export function SendPayoutPanel({ sellerKey, sellerName, earningIds, totalMinor, amountLabel, accountSummary }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<PayoutActionResult | null>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const openRef = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)
  const titleId = useId()

  useEffect(() => {
    if (confirming) confirmRef.current?.focus()
    else if (refocus.current) {
      refocus.current = false
      openRef.current?.focus()
    }
  }, [confirming])

  function cancel() {
    if (pending) return
    refocus.current = true
    setConfirming(false)
  }

  async function send() {
    if (pending) return
    setPending(true)
    setResult(null)
    let outcome: PayoutActionResult
    try {
      outcome = await sendPayoutAction({ sellerKey, earningIds, expectedTotalMinor: totalMinor })
    } catch {
      outcome = { ok: false, error: "We couldn't reach Sea N Shore, so we don't know whether the payout was created. Open the payouts queue and check before trying again." }
    }
    setPending(false)
    setResult(outcome)
    if (outcome.ok) {
      setConfirming(false)
      startTransition(() => router.refresh())
    }
  }

  if (result?.ok) {
    return (
      <div className="space-y-3">
        <p role="status" className={`rounded-xl border px-4 py-3 text-sm font-medium leading-6 ${toneByState[result.state] ?? 'border-amber-200 bg-amber-50 text-amber-950'}`}>
          {result.message}
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href={`/admin/payments/payouts/${result.payoutId}`} className={textLinkClass}>View this payout</Link>
          <Link href="/admin/payments/payouts" className={textLinkClass}>Back to the payouts queue</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {!confirming ? (
        <button ref={openRef} type="button" onClick={() => { setResult(null); setConfirming(true) }} className={primaryButtonClass}>
          <Send aria-hidden="true" className="size-4" /> Send {amountLabel} via Cashfree
        </button>
      ) : (
        <div role="group" aria-labelledby={titleId} onKeyDown={(event) => { if (event.key === 'Escape') cancel() }} className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <p id={titleId} className="font-semibold text-navy-950">Send {amountLabel} to {sellerName}?</p>
          <p className="text-sm leading-6 text-navy-800">
            Cashfree transfers the money to {accountSummary} straight away. A sent payout can&apos;t be called back. The {earningIds.length} item{earningIds.length === 1 ? '' : 's'} listed above will be marked as paid once the bank confirms.
          </p>
          <div className="flex flex-wrap gap-2">
            <button ref={confirmRef} type="button" onClick={() => { void send() }} disabled={pending} aria-busy={pending || undefined} className={primaryButtonClass}>
              {pending ? 'Sending…' : `Yes, send ${amountLabel}`}
            </button>
            <button type="button" onClick={cancel} disabled={pending} className={secondaryButtonClass}>Not now</button>
          </div>
        </div>
      )}
      {result && !result.ok ? (
        <div role="alert" className="space-y-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium leading-6 text-red-800">
          <p>{result.error}</p>
          <button type="button" onClick={() => { setResult(null); setConfirming(false); startTransition(() => router.refresh()) }} className={`${secondaryButtonClass} min-h-9`}>
            Reload this review
          </button>
        </div>
      ) : null}
    </div>
  )
}
