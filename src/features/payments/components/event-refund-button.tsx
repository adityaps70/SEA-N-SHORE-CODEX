'use client'

import { RotateCcw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { refundEventPaymentAction } from '../event-payment-actions'

type Props = {
  orderId: string
  amountLabel: string
  attendeeName: string
  /** The attendee still holds a confirmed seat (the refund releases it). */
  seatConfirmed: boolean
  /** A previous refund attempt failed; this is a retry. */
  retry?: boolean
}

/** Organiser / admin refund of one paid ticket, with an inline confirmation step. */
export function EventRefundButton({ orderId, amountLabel, attendeeName, seatConfirmed, retry = false }: Props) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const openRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (confirming) confirmRef.current?.focus()
  }, [confirming])

  function cancel() {
    setConfirming(false)
    openRef.current?.focus()
  }

  async function refund() {
    setPending(true)
    setError(null)
    let result: Awaited<ReturnType<typeof refundEventPaymentAction>>
    try {
      result = await refundEventPaymentAction(orderId)
    } catch {
      result = { ok: false, error: 'We could not reach Sea N Shore. Nothing was refunded. Check your connection and try again.' }
    }
    setPending(false)
    if (result.ok) {
      setConfirming(false)
      setDone(result.message)
      startTransition(() => router.refresh())
      return
    }
    setError(result.error)
  }

  if (done) {
    return <p role="status" className="text-xs font-semibold leading-5 text-emerald-800 sm:max-w-xs sm:text-right">{done}</p>
  }

  if (!confirming) {
    return (
      <div className="sm:text-right">
        <button
          ref={openRef}
          type="button"
          onClick={() => { setError(null); setConfirming(true) }}
          className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-mist-200 bg-white px-3 text-xs font-bold text-navy-900 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
        >
          <RotateCcw aria-hidden="true" className="size-3.5" />
          {retry ? `Try refund of ${amountLabel} again` : `Refund ${amountLabel}`}
        </button>
      </div>
    )
  }

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      onKeyDown={(event) => { if (event.key === 'Escape' && !pending) cancel() }}
      className="w-full space-y-2 rounded-xl border border-rose-200 bg-rose-50/60 p-3 text-left sm:max-w-sm"
    >
      <p id={titleId} className="text-sm font-bold text-navy-950">Refund {amountLabel} to {attendeeName}?</p>
      <p className="text-xs leading-5 text-navy-700">
        The full amount goes back to their original payment method.{seatConfirmed ? ' Their seat will be released.' : ''} This can&apos;t be undone.
      </p>
      {error ? <p className="text-xs font-semibold leading-5 text-rose-700" role="alert">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          ref={confirmRef}
          type="button"
          onClick={() => { void refund() }}
          disabled={pending}
          aria-busy={pending || undefined}
          className="inline-flex min-h-9 cursor-pointer items-center rounded-lg bg-rose-700 px-3 text-xs font-bold text-white transition hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Refunding…' : `Yes, refund ${amountLabel}`}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={pending}
          className="inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-mist-200 bg-white px-3 text-xs font-bold text-navy-900 transition hover:bg-mist-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Keep payment
        </button>
      </div>
    </div>
  )
}
