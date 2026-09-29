export type JumpLink = { href: string; label: string }

/**
 * Phones only (below md): a "Jump to" row of chips at the top of a long page that link to
 * its sections. The row scrolls sideways; each 32px chip has a 44px tap area.
 */
export function JumpToChips({ links, label = 'Jump to' }: { links: JumpLink[]; label?: string }) {
  if (links.length < 2) return null
  return (
    <nav aria-label={label} className="-mx-4 mb-4 md:hidden" data-jump-to="">
      <ul className="flex items-center gap-2 overflow-x-auto px-4 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <li aria-hidden="true" className="shrink-0 pr-1 text-xs font-bold uppercase tracking-[0.14em] text-muted">
          {label}
        </li>
        {links.map((link) => (
          <li key={link.href} className="shrink-0">
            <a
              href={link.href}
              className="relative inline-flex h-8 items-center whitespace-nowrap rounded-full border border-mist-200 bg-white px-3 text-sm font-semibold text-navy-900 transition-colors after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] hover:border-ocean-300 hover:bg-mist-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
