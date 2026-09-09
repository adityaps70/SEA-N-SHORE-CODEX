import Link from 'next/link'
import { Bookmark, BriefcaseBusiness, MessageCircleQuestion, PencilLine, UserRoundSearch } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { OwnProfile } from '@/features/profiles/types'
import { FeedProfileCard } from './feed-profile-card'

const actionClass = 'flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-semibold text-navy-900 transition hover:bg-mist-50 hover:text-ocean-700'

export function FeedLeftRail({ profile }: { profile: OwnProfile }) {
  return (
    <div className="space-y-3">
      <FeedProfileCard profile={profile} />

      <Card className="border border-mist-100 p-3">
        <h2 className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Quick actions</h2>
        <nav aria-label="Quick actions" className="mt-1.5 space-y-0.5">
          <Link href="#feed-composer" className={actionClass}>
            <PencilLine aria-hidden="true" className="size-4 text-ocean-700" />
            Post update
          </Link>
          <Link href="/community" className={actionClass}>
            <MessageCircleQuestion aria-hidden="true" className="size-4 text-ocean-700" />
            Ask community
          </Link>
          <Link href="/jobs" className={actionClass}>
            <BriefcaseBusiness aria-hidden="true" className="size-4 text-ocean-700" />
            Find a job
          </Link>
          <Link href="/network" className={actionClass}>
            <UserRoundSearch aria-hidden="true" className="size-4 text-ocean-700" />
            Find people
          </Link>
          <Link href="/saved" className={actionClass}>
            <Bookmark aria-hidden="true" className="size-4 text-ocean-700" />
            Saved
          </Link>
        </nav>
      </Card>
    </div>
  )
}
