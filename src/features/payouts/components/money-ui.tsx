import Link from 'next/link'
import type { ReactNode } from 'react'
import type { Tone } from '../payout-rules'

/** Small shared pieces for the money screens (settings and admin). */

const toneClasses: Record<Tone, string> = {
  neutral: 'border-mist-200 bg-mist-50 text-navy-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-red-200 bg-red-50 text-red-800',
  info: 'border-ocean-200 bg-ocean-50 text-ocean-800',
}

export function StatusChip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-semibold ${toneClasses[tone]}`}>{children}</span>
}

export function formatDay(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(date)
}

export function formatDayTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(date)
}

export type SwitcherOption = { key: string; label: string; href: string; active: boolean }

/** "You | Organization A | Organization B" chips for pages that cover several sellers. */
export function SellerSwitcher({ label, options }: { label: string; options: SwitcherOption[] }) {
  if (options.length < 2) return null
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <Link
          key={option.key}
          href={option.href}
          aria-current={option.active ? 'page' : undefined}
          className={`inline-flex min-h-9 max-w-full items-center rounded-lg border px-3 text-sm font-semibold transition ${
            option.active
              ? 'border-navy-950 bg-navy-950 text-white hover:bg-navy-900'
              : 'border-mist-200 bg-white text-navy-900 hover:border-ocean-300 hover:bg-mist-50'
          }`}
        >
          <span className="truncate">{option.label}</span>
        </Link>
      ))}
    </nav>
  )
}

export function StatTile({ label, value, hint, emphasis = false }: { label: string; value: string; hint?: ReactNode; emphasis?: boolean }) {
  return (
    <div className={`min-w-0 rounded-2xl border p-4 ${emphasis ? 'border-ocean-200 bg-ocean-50/60' : 'border-mist-100 bg-white'} shadow-sm`}>
      <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className="mt-1 break-words text-2xl font-bold tracking-tight text-navy-950">{value}</dd>
      {hint ? <dd className="mt-1 text-xs leading-5 text-muted">{hint}</dd> : null}
    </div>
  )
}
