import Link from 'next/link'
import { cn } from '@/lib/cn'
import { POST_CATEGORIES, POST_CATEGORY_LABELS, type PostCategory } from '../types'

const chipBase =
  'relative inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-4 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 min-h-9 max-md:min-h-8 max-md:px-3.5 max-md:text-[13px] max-md:before:absolute max-md:before:-inset-y-1.5 max-md:before:inset-x-0'
const chipSelected = 'border-navy-950 bg-navy-950 text-white'
const chipIdle = 'border-mist-200 bg-white text-navy-900 hover:border-ocean-500 hover:text-ocean-700 max-md:border-mist-300'

export function feedCategoryHref(category?: PostCategory) {
  return category ? `/home?category=${category}` : '/home'
}

/**
 * Topic chips above the Home feed (All, Maritime News, …). One horizontally scrolling row on
 * every screen size; each chip is a link to /home?category=…, which the Home page filters by.
 */
export function FeedCategoryFilter({ category, className = '' }: { category?: PostCategory; className?: string }) {
  return (
    <nav
      aria-label="Filter maritime feed"
      className={cn('-mx-1 overflow-x-auto px-1 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-md:-mx-4 max-md:px-4', className)}
    >
      <ul className="flex min-w-max gap-2">
        <li>
          <Link href={feedCategoryHref()} aria-current={!category ? 'page' : undefined} className={cn(chipBase, !category ? chipSelected : chipIdle)}>
            All
          </Link>
        </li>
        {POST_CATEGORIES.map((value) => (
          <li key={value}>
            <Link
              href={feedCategoryHref(value)}
              aria-current={category === value ? 'page' : undefined}
              className={cn(chipBase, category === value ? chipSelected : chipIdle)}
            >
              {POST_CATEGORY_LABELS[value]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
