'use client'

import { Clock3, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { ConfirmCheckoutResult } from '@/features/payments/checkout-types'
import { confirmCoursePaymentAction } from '../course-payment-actions'

type Props = {
  courseId: string
  courseSlug: string
  orderId: string
  amountLabel: string
  /** When the checkout was started, already formatted for the learner. */
  startedLabel: string
}

/**
 * The learner started a checkout that is not confirmed yet (closed tab, slow bank).
 * "Check payment status" asks the payment provider on the server; nothing is
 * decided in the browser.
 */
export function CoursePaymentPendingNotice({ courseId, courseSlug, orderId, amountLabel, startedLabel }: Props) {
  const router = useRouter()
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<ConfirmCheckoutResult | null>(null)
  const [, startTransition] = useTransition()

  async function check() {
    setChecking(true)
    setResult(null)
    let answer: ConfirmCheckoutResult
    try {
      answer = await confirmCoursePaymentAction({ courseId, orderId, proof: null })
    } catch {
      answer = { ok: false, state: 'error', error: 'We could not reach Sea N Shore. Check your connection and try again. If money was taken, the course unlocks automatically.' }
    }
    setChecking(false)
    setResult(answer)
    startTransition(() => {
      if (answer.ok) router.push(`/learn/courses/${courseSlug}/learn`)
      else if (answer.state !== 'processing' && answer.state !== 'error') router.refresh()
    })
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-amber-950 sm:p-4 lg:p-3" role="region" aria-label="Payment not confirmed yet">
      <p className="flex items-center gap-2 text-sm font-bold">
        <Clock3 aria-hidden="true" className="size-4 shrink-0 text-amber-800" />
        Checking a payment you started
      </p>
      <p className="mt-1 text-xs leading-5">
        You opened checkout for {amountLabel} at {startedLabel}. If you finished paying, check its status — the course unlocks as soon as the payment is confirmed. If you didn&apos;t pay, no money was taken.
      </p>
      <button
        type="button"
        onClick={() => { void check() }}
        disabled={checking}
        aria-busy={checking || undefined}
        className="mt-3 inline-flex min-h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-amber-300 bg-white px-3 text-sm font-bold text-amber-950 transition hover:border-amber-400 hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {checking ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
        {checking ? 'Checking your payment…' : 'Check payment status'}
      </button>
      <div aria-live="polite">
        {result ? (
          <p className={`mt-2 text-xs font-semibold leading-5 ${result.ok ? 'text-emerald-800' : 'text-amber-950'}`}>
            {result.ok ? result.message : result.error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
