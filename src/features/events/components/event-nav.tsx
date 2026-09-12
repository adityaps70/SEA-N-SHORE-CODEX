import Link from 'next/link'

export function EventNav({ active }: { active: 'discover' | 'my' | 'hosting' }) {
  const links = [
    { href: '/events', label: 'Discover', key: 'discover' as const },
    { href: '/events/my', label: 'My Events', key: 'my' as const },
    { href: '/events/hosting', label: 'Hosting', key: 'hosting' as const },
  ]
  return (
    <nav aria-label="Events" className="flex flex-wrap gap-2 rounded-2xl border border-mist-100 bg-white p-2 shadow-[var(--shadow-card)]">
      {links.map((link) => (
        <Link key={link.key} href={link.href} className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${active === link.key ? 'bg-navy-950 text-white' : 'text-navy-800 hover:bg-mist-50'}`}>
          {link.label}
        </Link>
      ))}
      <Link href="/events/create" className="ml-auto rounded-xl bg-teal-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-teal-700">Create event</Link>
    </nav>
  )
}
