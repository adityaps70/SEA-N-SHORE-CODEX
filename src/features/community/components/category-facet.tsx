import Link from 'next/link'
import type { CommunityCategoryChip } from '../types'

/**
 * Round I (I2): the search page's community category facet: the shown categories among the matching communities,
 * in admin order, with how many match. `hrefFor(null)` clears it.
 */
export function CommunityCategoryFacet({ chips, active, hrefFor }: {
  chips: readonly CommunityCategoryChip[]
  active: string | null
  hrefFor: (slug: string | null) => string
}) {
  if (!chips.length) return null
  const chipClass = 'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-mist-300 bg-white px-3 text-sm font-semibold text-navy-700 hover:bg-mist-50 aria-[current=page]:border-navy-950 aria-[current=page]:bg-navy-950 aria-[current=page]:text-white'
  return (
    <nav aria-label="Filter communities by category" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
      <Link href={hrefFor(null)} aria-current={active ? undefined : 'page'} className={chipClass}>All categories</Link>
      {chips.map((chip) => (
        <Link key={chip.id} href={hrefFor(chip.slug)} aria-current={active === chip.slug ? 'page' : undefined} className={chipClass}>
          {chip.name} <span className="text-xs opacity-80">{chip.count}</span>
        </Link>
      ))}
    </nav>
  )
}
