'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, CircleHelp, XCircle } from 'lucide-react'
import { secondaryButtonClass } from '@/components/ui/interactive-styles'
import type { PaymentsHealth, PaymentsHealthLine } from '@/features/payments/payments-health'
import { checkCashfreeConnectionAction } from '../../admin-actions'

const TONE_TEXT: Record<PaymentsHealthLine['tone'], string> = { ok: 'OK', problem: 'Needs attention', unknown: 'Unknown' }

function ToneIcon({ tone }: { tone: PaymentsHealthLine['tone'] }) {
  if (tone === 'ok') return <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-700" />
  if (tone === 'problem') return <XCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-red-700" />
  return <CircleHelp aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted" />
}

/** Hotfix P1: read-only Cashfree status for admins. Shows status only, never a key or a value. */
export function PaymentsHealthCard({ health }: { health: PaymentsHealth }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const titleId = useId()

  async function check() {
    if (pending) return
    setPending(true)
    setResult(null)
    let outcome: Awaited<ReturnType<typeof checkCashfreeConnectionAction>>
    try {
      outcome = await checkCashfreeConnectionAction()
    } catch {
      outcome = { ok: false, error: "We couldn't reach Sea N Shore. Check your connection and try again." }
    }
    setPending(false)
    setResult(outcome.ok ? { ok: true, message: outcome.message } : { ok: false, message: outcome.error })
    router.refresh()
  }

  return (
    <section aria-labelledby={titleId} className="overflow-hidden rounded-xl border border-mist-100 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-mist-100 px-5 py-3">
        <div className="min-w-0">
          <h3 id={titleId} className="flex flex-wrap items-center gap-2 text-sm font-bold text-navy-950">
            Payments health
            <span className={`inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-semibold ${health.allOk ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>{health.allOk ? 'All good' : 'Needs attention'}</span>
          </h3>
          <p className="text-xs text-muted">Cashfree setup, status only. Keys and details are never shown.</p>
        </div>
        <button type="button" onClick={() => { void check() }} disabled={pending} aria-busy={pending || undefined} className={secondaryButtonClass}>
          {pending ? 'Checking…' : 'Check Cashfree now'}
        </button>
      </div>
      <ul aria-label="Payments health" className="divide-y divide-mist-100">
        {health.lines.map((line) => (
          <li key={line.id} data-testid={`payments-health-${line.id}`} className="flex items-start gap-3 px-5 py-2.5 text-sm">
            <ToneIcon tone={line.tone} />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="font-semibold text-navy-950">{line.label}</span>
                <span className="text-navy-900">
                  <span className="sr-only">{TONE_TEXT[line.tone]}: </span>
                  {line.value}
                </span>
              </p>
              {line.detail ? <p className="mt-0.5 text-xs text-muted">{line.detail}</p> : null}
            </div>
          </li>
        ))}
      </ul>
      <div aria-live="polite">
        {result ? (
          <p role={result.ok ? 'status' : 'alert'} className={`border-t px-5 py-2.5 text-sm ${result.ok ? 'border-emerald-100 bg-emerald-50 text-emerald-900' : 'border-red-100 bg-red-50 text-red-900'}`}>
            {result.message}
          </p>
        ) : null}
      </div>
    </section>
  )
}
