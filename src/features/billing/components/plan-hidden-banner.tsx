import Link from 'next/link'
import { EyeOff } from 'lucide-react'
import { PLAN_HIDDEN_MESSAGE, planRenewHref } from '@/features/billing/plan-visibility-copy'

/**
 * Shown to the owner on a job, event or course that nobody else can see because the
 * Creator Pro / Organization Pro plan ended. Links to the right checkout.
 */
export function PlanHiddenBanner({ companyId, className = '' }: { companyId: string | null; className?: string }) {
  return (
    <p
      role="note"
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 ${className}`}
    >
      <EyeOff aria-hidden="true" className="size-4 shrink-0" />
      <span>{PLAN_HIDDEN_MESSAGE}</span>
      <Link
        href={planRenewHref({ companyId })}
        className="font-semibold text-ocean-700 underline underline-offset-2 hover:text-navy-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500"
      >
        {companyId ? 'Renew Organization Pro' : 'Renew Creator Pro'}
      </Link>
    </p>
  )
}
