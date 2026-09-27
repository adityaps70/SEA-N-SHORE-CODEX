'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  { href: '/admin/payments', label: 'Overview', exact: true },
  { href: '/admin/payments/payouts', label: 'Payouts', exact: false },
  { href: '/admin/payments/fees', label: 'Fees', exact: false },
  { href: '/admin/payments/transactions', label: 'Payments', exact: false },
]

const baseClass = 'inline-flex min-h-9 shrink-0 cursor-pointer items-center rounded-lg border px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500'
const idleClass = 'border-mist-200 bg-white text-navy-900 hover:border-ocean-300 hover:bg-mist-50'
const activeClass = 'border-navy-950 bg-navy-950 text-white hover:bg-navy-900'

/** Section tabs inside Admin → Payments. */
export function PaymentsAdminTabs() {
  const pathname = usePathname() ?? ''
  return (
    <nav aria-label="Payments sections" className="flex flex-wrap gap-1.5">
      {tabs.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname === tab.href || pathname.startsWith(`${tab.href}/`)
        return (
          <Link key={tab.href} href={tab.href} aria-current={active ? 'page' : undefined} className={`${baseClass} ${active ? activeClass : idleClass}`}>
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
