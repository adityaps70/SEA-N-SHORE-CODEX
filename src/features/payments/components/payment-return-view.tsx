import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Clock3, RotateCcw, XCircle } from 'lucide-react'
import type { ViewerConfirmResult } from '../order-handler-types'

export type PaymentReturnResult = Omit<ViewerConfirmResult, 'state'> & { state: ViewerConfirmResult['state'] | 'error' }

const TONES: Record<PaymentReturnResult['state'], { icon: typeof CheckCircle2; ring: string }> = {
  paid: { icon: CheckCircle2, ring: 'bg-emerald-50 text-emerald-700' },
  refunded: { icon: RotateCcw, ring: 'bg-mist-100 text-navy-700' },
  refund_due: { icon: AlertTriangle, ring: 'bg-amber-50 text-amber-800' },
  processing: { icon: Clock3, ring: 'bg-ocean-50 text-ocean-700' },
  not_paid: { icon: XCircle, ring: 'bg-mist-100 text-navy-700' },
  failed: { icon: XCircle, ring: 'bg-rose-50 text-rose-700' },
  expired: { icon: Clock3, ring: 'bg-mist-100 text-navy-700' },
  not_found: { icon: AlertTriangle, ring: 'bg-amber-50 text-amber-800' },
  error: { icon: AlertTriangle, ring: 'bg-amber-50 text-amber-800' },
}

/** Result card for /payments/return after the server asked the gateway. */
export function PaymentReturnView({ result, checkAgainHref }: { result: PaymentReturnResult; checkAgainHref: string | null }) {
  const tone = TONES[result.state]
  const Icon = tone.icon
  const canCheckAgain = Boolean(checkAgainHref) && (result.state === 'processing' || result.state === 'error')
  return (
    <section className="mx-auto w-full max-w-xl rounded-[1.75rem] border border-mist-100 bg-white p-6 text-center shadow-[var(--shadow-card)] sm:p-10" aria-labelledby="payment-return-title">
      <span className={`mx-auto grid size-14 place-items-center rounded-full ${tone.ring}`}>
        <Icon aria-hidden="true" className="size-7" />
      </span>
      <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Payment status</p>
      <h1 id="payment-return-title" className="mt-1 text-2xl font-bold text-navy-950 sm:text-3xl">{result.title}</h1>
      <p role="status" className="mx-auto mt-3 max-w-md break-words text-sm leading-6 text-navy-700">{result.message}</p>
      <div className="mt-7 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
        <Link
          href={result.returnHref}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-ocean-700 px-5 text-sm font-semibold text-white transition hover:bg-ocean-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-700"
        >
          {result.returnLabel}
        </Link>
        {canCheckAgain ? (
          <a
            href={checkAgainHref!}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-mist-200 bg-white px-5 text-sm font-semibold text-navy-900 transition hover:border-teal-300 hover:bg-teal-50"
          >
            Check again
          </a>
        ) : null}
      </div>
    </section>
  )
}
