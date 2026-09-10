import Link from 'next/link'

type HiringSubnavProps = {
  active: 'overview' | 'jobs' | 'company'
}

const items = [
  { id: 'overview', label: 'Overview', href: '/hiring' },
  { id: 'jobs', label: 'Jobs', href: '/hiring/jobs' },
  { id: 'company', label: 'Company', href: '/hiring/company' },
] as const

export function HiringSubnav({ active }: HiringSubnavProps) {
  return (
    <nav aria-label="Hiring workspace" className="overflow-x-auto rounded-2xl border border-mist-100 bg-white p-1.5 shadow-[var(--shadow-card)]">
      <div className="flex min-w-max gap-1">
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            aria-current={active === item.id ? 'page' : undefined}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
              active === item.id
                ? 'bg-navy-950 text-white shadow-sm'
                : 'text-muted hover:bg-mist-50 hover:text-navy-950'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}
