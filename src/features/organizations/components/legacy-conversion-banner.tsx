import Link from 'next/link'
import { ArrowRight, Building2 } from 'lucide-react'

export function LegacyOrganizationConversionBanner() {
  return (
    <div className="border-b border-amber-200 bg-amber-50">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white text-amber-800 shadow-sm">
            <Building2 aria-hidden="true" className="size-4" />
          </span>
          <div>
            <p className="text-sm font-bold text-amber-950">Finish account conversion</p>
            <p className="mt-0.5 text-xs leading-5 text-amber-900">
              Your account still uses the old organization-style profile. Convert it to a personal account plus a separate organization workspace without losing your history.
            </p>
          </div>
        </div>
        <Link
          href="/organization-conversion"
          className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-900 px-4 text-xs font-bold text-white hover:bg-amber-950"
        >
          Convert account <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>
    </div>
  )
}
