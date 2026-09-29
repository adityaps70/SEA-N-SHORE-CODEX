'use client'

import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { useState, useTransition } from 'react'
import { startPlanTrialAction } from '../actions'
import type { PlanCheckoutTarget } from '../checkout-messages'

const primaryButton = 'inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-teal-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto'

/** "Start free trial": switches the plan on at once, with no payment details. */
export function TrialStartButton({ target, planLabel, months }: { target: PlanCheckoutTarget; planLabel: string; months: number }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  async function start() {
    setPending(true)
    setResult(null)
    try {
      const outcome = await startPlanTrialAction({ target })
      if (outcome.ok) {
        setResult({ tone: 'ok', text: outcome.message })
        startTransition(() => router.refresh())
      } else {
        setResult({ tone: 'error', text: outcome.error })
      }
    } catch {
      setResult({ tone: 'error', text: 'We couldn’t reach Sea N Shore. Check your connection and try again.' })
    } finally {
      setPending(false)
    }
  }

  if (result?.tone === 'ok') {
    return <p role="status" className="text-sm font-semibold text-emerald-800">{result.text}</p>
  }

  return (
    <div className="space-y-2">
      <button type="button" onClick={() => { void start() }} disabled={pending} aria-busy={pending || undefined} className={primaryButton}>
        <Sparkles aria-hidden="true" className="size-4" />
        {pending ? 'Starting your trial…' : `Start free trial — ${months} months of ${planLabel}`}
      </button>
      {result?.tone === 'error' ? <p role="alert" className="text-sm font-medium text-rose-700">{result.text}</p> : null}
    </div>
  )
}
