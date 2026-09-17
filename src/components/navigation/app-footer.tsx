import Link from 'next/link'

const trustLinks = [
  { href: '/about', label: 'About' },
  { href: '/accessibility', label: 'Accessibility' },
  { href: '/help', label: 'Help' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
] as const

export function AppFooter() {
  return (
    <footer className="mx-auto mt-8 w-full max-w-7xl px-4 pb-24 sm:px-6 md:pb-8" aria-label="Sea N Shore trust and legal links">
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-mist-100 py-5 text-xs text-muted">
        <p>© {new Date().getFullYear()} Sea N Shore · Global Shipping Community</p>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Trust and legal">
          {trustLinks.map((link) => (
            <Link key={link.href} href={link.href} className="font-semibold transition hover:text-ocean-700">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  )
}
