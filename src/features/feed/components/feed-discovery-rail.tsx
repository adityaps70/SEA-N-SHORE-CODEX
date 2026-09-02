import Link from 'next/link'
import { BriefcaseBusiness, CalendarDays, UsersRound } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { PeopleYouMayKnow } from '@/features/network/components/people-you-may-know'
import type { NetworkProfile } from '@/features/network/types'
import { POST_CATEGORIES, POST_CATEGORY_LABELS, type PostCategory } from '../types'

export function FeedDiscoveryRail({
  category,
  suggestions,
}: {
  category?: PostCategory
  suggestions: NetworkProfile[]
}) {
  return (
    <div className="space-y-4">
      <PeopleYouMayKnow profiles={suggestions} />

      <Card className="border border-mist-100 p-5">
        <p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Maritime topics</p>
        <h2 className="mt-1 text-lg font-semibold text-navy-950">Join the conversation</h2>
        <nav aria-label="Maritime feed topics" className="mt-4 space-y-1">
          {POST_CATEGORIES.map((value) => (
            <Link
              key={value}
              href={`/home?category=${value}`}
              aria-current={category === value ? 'page' : undefined}
              className="block rounded-xl px-3 py-2 text-sm font-medium text-navy-900 hover:bg-mist-50 aria-[current=page]:bg-mist-50 aria-[current=page]:text-ocean-700"
            >
              {POST_CATEGORY_LABELS[value]}
            </Link>
          ))}
        </nav>
      </Card>

      <Card className="border border-mist-100 p-4">
        <div className="space-y-2">
          <Link href="/network" className="flex min-h-12 items-center gap-3 rounded-xl px-2 text-sm font-semibold text-navy-900 hover:bg-mist-50">
            <UsersRound aria-hidden="true" className="size-5 text-ocean-700" />
            Explore the professional network
          </Link>
          <Link href="/events" className="flex min-h-12 items-center gap-3 rounded-xl px-2 text-sm font-semibold text-navy-900 hover:bg-mist-50">
            <CalendarDays aria-hidden="true" className="size-5 text-ocean-700" />
            Browse maritime events
          </Link>
          <Link href="/jobs" className="flex min-h-12 items-center gap-3 rounded-xl px-2 text-sm font-semibold text-navy-900 hover:bg-mist-50">
            <BriefcaseBusiness aria-hidden="true" className="size-5 text-ocean-700" />
            See maritime opportunities
          </Link>
        </div>
      </Card>
    </div>
  )
}
