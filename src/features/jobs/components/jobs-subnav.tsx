import Link from 'next/link'
import { BellRing, Bookmark, BriefcaseBusiness, ClipboardCheck } from 'lucide-react'

const items = [
  { href: '/jobs', label: 'Discover', icon: BriefcaseBusiness },
  { href: '/jobs/saved', label: 'Saved', icon: Bookmark },
  { href: '/jobs/applications', label: 'Applications', icon: ClipboardCheck },
  { href: '/jobs/alerts', label: 'Alerts', icon: BellRing },
] as const

export function JobsSubnav({ active }: { active: 'discover' | 'saved' | 'applications' | 'alerts' }) {
  return (
    <nav aria-label="Jobs workspace" className="mt-4 flex gap-2 overflow-x-auto pb-1">
      {items.map(({ href, label, icon: Icon }) => {
        const selected = active === label.toLowerCase()
        return <Link key={href} href={href} className={selected ? 'inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white' : 'inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border border-mist-100 bg-white px-4 text-sm font-semibold text-navy-950 hover:bg-mist-50'}><Icon aria-hidden="true" className="size-4" />{label}</Link>
      })}
    </nav>
  )
}
