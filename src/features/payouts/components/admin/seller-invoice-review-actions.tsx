'use client'

import { Check, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from 'react'
import { primaryButtonClass, secondaryButtonClass } from '@/components/ui/interactive-styles'
import { approveSellerInvoiceAction, rejectSellerInvoiceAction, type SellerInvoiceReviewResult } from '../../seller-invoice-admin-actions'
import { adminInputClass } from './fee-settings-form'

type Props = {
  invoiceId: string
  /** e.g. "September 2026 · ₹4,237.50", for the button and dialog labels. */
  summary: string
  /** False when the invoice no longer matches the month's course total: only rejecting makes sense. */
  canApprove: boolean
}

/** Admin: approve a seller's monthly invoice, or reject it with a note the seller sees. */
export function SellerInvoiceReviewActions({ invoiceId, summary, canApprove }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [mode, setMode] = useState<'idle' | 'reject'>('idle')
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<SellerInvoiceReviewResult | null>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const id = useId()

  useEffect(() => {
    if (mode === 'reject') noteRef.current?.focus()
  }, [mode])

  async function run(action: () => Promise<SellerInvoiceReviewResult>) {
    if (pending) return
    setPending(true)
    setResult(null)
    let outcome: SellerInvoiceReviewResult
    try {
      outcome = await action()
    } catch {
      outcome = { ok: false, error: "We couldn't reach Sea N Shore. Nothing was changed. Check your connection and try again." }
    }
    setPending(false)
    setResult(outcome)
    if (outcome.ok) {
      setMode('idle')
      startTransition(() => router.refresh())
    }
  }

  function reject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const note = String(new FormData(event.currentTarget).get('note') ?? '')
    void run(() => rejectSellerInvoiceAction(invoiceId, note))
  }

  if (result?.ok) {
    return <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">{result.message}</p>
  }

  return (
    <div className="space-y-2">
      {mode === 'idle' ? (
        <div className="flex flex-wrap gap-2 md:justify-end">
          {canApprove ? (
            <button type="button" onClick={() => { void run(() => approveSellerInvoiceAction(invoiceId)) }} disabled={pending} aria-busy={pending || undefined} aria-label={`Approve invoice for ${summary}`} className={`${primaryButtonClass} min-h-9`}>
              <Check aria-hidden="true" className="size-4" /> {pending ? 'Approving…' : 'Approve'}
            </button>
          ) : null}
          <button type="button" onClick={() => { setResult(null); setMode('reject') }} disabled={pending} aria-label={`Reject invoice for ${summary}`} className={`${secondaryButtonClass} min-h-9 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-800`}>
            <X aria-hidden="true" className="size-4" /> Reject
          </button>
        </div>
      ) : (
        <form onSubmit={reject} onKeyDown={(event) => { if (event.key === 'Escape' && !pending) setMode('idle') }} aria-label={`Reject invoice for ${summary}`} className="space-y-2 rounded-lg border border-rose-200 bg-rose-50/60 p-3 text-left">
          <label htmlFor={`${id}-note`} className="text-sm font-semibold text-navy-900">What should the seller fix?</label>
          <textarea ref={noteRef} id={`${id}-note`} name="note" rows={3} maxLength={500} className={`${adminInputClass} min-h-20 py-2`} placeholder="For example: the invoice total must be ₹4,237.50, or the GSTIN is missing." />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending} aria-busy={pending || undefined} className={`${primaryButtonClass} min-h-9`}>{pending ? 'Rejecting…' : 'Reject invoice'}</button>
            <button type="button" onClick={() => setMode('idle')} disabled={pending} className={`${secondaryButtonClass} min-h-9`}>Cancel</button>
          </div>
        </form>
      )}
      {result && !result.ok ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{result.error}</p> : null}
    </div>
  )
}
