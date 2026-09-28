import Link from 'next/link'
import { Bookmark, BriefcaseBusiness, ChevronRight, UserRoundSearch } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { OwnProfile } from '@/features/profiles/types'
import type { ProfilePortfolioCompletion } from '../profile-completion'
import { FeedProfileCard } from './feed-profile-card'

type QuickAction = { href: string; label: string; icon: LucideIcon }

/** Posting happens in the Home composer and Community is in the header, so neither is repeated here. */
export const QUICK_ACTIONS: readonly QuickAction[] = [
  { href: '/jobs', label: 'Find a job', icon: BriefcaseBusiness },
  { href: '/network', label: 'Find people', icon: UserRoundSearch },
  { href: '/saved', label: 'Saved posts', icon: Bookmark },
]

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500'
const rowClass = `group flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm font-semibold text-navy-900 transition hover:bg-ocean-50 hover:text-ocean-700 ${focusRing}`
const chipClass = `inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-2 rounded-full border border-mist-200 bg-white px-3.5 text-sm font-semibold text-navy-900 transition hover:border-ocean-300 hover:bg-ocean-50 hover:text-ocean-700 ${focusRing}`

/**
 * Home shortcuts. `compact` is the horizontal row shown on phones and tablets,
 * where the left rail is hidden.
 */
export function FeedQuickActions({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <nav aria-label="Quick actions" className="-mx-1 flex gap-2 overflow-x-auto p-1 lg:hidden">
        {QUICK_ACTIONS.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={chipClass}>
            <Icon aria-hidden="true" className="size-4 text-ocean-700" />
            {label}
          </Link>
        ))}
      </nav>
    )
  }

  return (
    <Card className="border border-mist-100 p-3">
      <h2 id="home-quick-actions" className="px-1 text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Quick actions</h2>
      <nav aria-labelledby="home-quick-actions" className="mt-1.5">
        <ul className="space-y-0.5">
          {QUICK_ACTIONS.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link href={href} className={rowClass}>
                <Icon aria-hidden="true" className="size-4 shrink-0 text-ocean-700" />
                <span className="min-w-0 flex-1">{label}</span>
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-ocean-700" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </Card>
  )
}

export function FeedLeftRail({
  profile,
  portfolioCompletion,
  verified = false,
}: {
  profile: OwnProfile
  portfolioCompletion: ProfilePortfolioCompletion
  verified?: boolean
}) {
  return (
    <div className="space-y-3">
      <FeedProfileCard profile={profile} portfolioCompletion={portfolioCompletion} verified={verified} />
      <FeedQuickActions />
    </div>
  )
}
