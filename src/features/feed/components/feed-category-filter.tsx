import Link from 'next/link'
import { cn } from '@/lib/cn'
import { POST_CATEGORIES, POST_CATEGORY_LABELS, type PostCategory } from '../types'

export function FeedCategoryFilter({ category }: { category?: PostCategory }) {
  return (
    <nav aria-label="Filter maritime feed" className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex min-w-max gap-2">
        <Link
          href="/home"
          aria-current={!category ? 'page' : undefined}
          className={cn(
            'inline-flex min-h-10 items-center rounded-xl border px-4 text-sm font-semibold transition-colors',
            !category
              ? 'border-ocean-700 bg-ocean-700 text-white'
              : 'border-mist-100 bg-white text-navy-900 hover:border-ocean-500 hover:text-ocean-700',
          )}
        >
          All
        </Link>
        {POST_CATEGORIES.map((value) => (
          <Link
            key={value}
            href={`/home?category=${value}`}
            aria-current={category === value ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-10 items-center rounded-xl border px-4 text-sm font-semibold transition-colors',
              category === value
                ? 'border-ocean-700 bg-ocean-700 text-white'
                : 'border-mist-100 bg-white text-navy-900 hover:border-ocean-500 hover:text-ocean-700',
            )}
          >
            {POST_CATEGORY_LABELS[value]}
          </Link>
        ))}
      </div>
    </nav>
  )
}
