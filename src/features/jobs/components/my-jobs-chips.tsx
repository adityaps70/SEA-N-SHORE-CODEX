import Link from 'next/link'
import { CHIP_ROW_CLASS, chipClass } from './mobile-chip'

const ITEMS = [
  { id: 'saved', label: 'Saved', href: '/jobs/saved' },
  { id: 'applications', label: 'Applied', href: '/jobs/applications' },
  { id: 'alerts', label: 'Alerts', href: '/jobs/alerts' },
] as const

/** Phone "My jobs" switcher (round 8): Saved · Applied · Alerts, below md only. */
export function MyJobsChips({ active }: { active: (typeof ITEMS)[number]['id'] }) {
  return (
    <nav aria-label="My jobs" className={`${CHIP_ROW_CLASS} -mt-1 mb-1 md:hidden`}>
      {ITEMS.map((item) => (
        <Link key={item.id} href={item.href} aria-current={active === item.id ? 'page' : undefined} className={chipClass(active === item.id)}>
          {item.label}
        </Link>
      ))}
    </nav>
  )
}
