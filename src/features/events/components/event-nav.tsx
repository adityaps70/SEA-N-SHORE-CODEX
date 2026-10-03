import Link from 'next/link'
import { Plus } from 'lucide-react'

/**
 * Discover · My Events · Hosting + Create. Below `md` it is one sideways-scrolling chip row
 * (selected chip navy filled) with a round "+" Create button (round 8); desktop is unchanged.
 */
export function EventNav({ active, className = '' }: { active: 'discover' | 'my' | 'hosting'; className?: string }) {
  const links = [
    { href: '/events', label: 'Discover', key: 'discover' as const },
    { href: '/events/my', label: 'My Events', key: 'my' as const },
    { href: '/events/hosting', label: 'Hosting', key: 'hosting' as const },
  ]
  return (
    <nav aria-label="Events" className={`flex flex-wrap gap-2 rounded-2xl border border-mist-100 bg-white p-2 shadow-[var(--shadow-card)] max-md:-mx-4 max-md:flex-nowrap max-md:items-center max-md:overflow-x-auto max-md:rounded-none max-md:border-x-0 max-md:border-t-0 max-md:px-4 max-md:py-2.5 max-md:shadow-none max-md:[scrollbar-width:none] ${className}`}>
      {links.map((link) => (
        <Link key={link.key} href={link.href} aria-current={active === link.key ? 'page' : undefined} className={`rounded-xl px-4 py-2 text-sm font-semibold transition max-md:inline-flex max-md:min-h-9 max-md:shrink-0 max-md:items-center max-md:whitespace-nowrap max-md:rounded-full max-md:border max-md:px-3.5 max-md:py-0 max-md:text-sm ${active === link.key ? 'bg-navy-950 text-white max-md:border-navy-950' : 'text-navy-800 hover:bg-mist-100 hover:text-navy-950 max-md:border-mist-300 max-md:bg-white'}`}>
          {link.label}
        </Link>
      ))}
      {/* Phones: a round "+" (label "Create event") so it stays on screen at 360px next to the chips. */}
      <Link href="/events/create" className="ml-auto rounded-xl bg-teal-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-teal-700 max-md:grid max-md:size-9 max-md:shrink-0 max-md:place-items-center max-md:rounded-full max-md:bg-ocean-700 max-md:p-0 max-md:hover:bg-ocean-800 max-md:relative max-md:before:absolute max-md:before:-inset-1 max-md:before:content-['']">
        <Plus aria-hidden="true" className="size-5 md:hidden" />
        <span className="max-md:sr-only">Create event</span>
      </Link>
    </nav>
  )
}
