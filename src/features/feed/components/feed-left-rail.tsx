import Link from 'next/link'
import { BriefcaseBusiness, MessageCircleQuestion, Network, PencilLine, UserRoundSearch, Bookmark, UserRound } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { OwnProfile } from '@/features/profiles/types'
import { calculateProfileCompletion } from '../profile-completion'
import { FeedProfileCard } from './feed-profile-card'

const actionClass = 'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-navy-900 transition hover:bg-mist-50 hover:text-ocean-700'
const shortcutClass = 'flex min-h-10 items-center justify-between rounded-lg px-2 text-sm font-medium text-navy-900 transition hover:bg-mist-50 hover:text-ocean-700'

export function FeedLeftRail({ profile }: { profile: OwnProfile }) {
  const completion = calculateProfileCompletion(profile)

  return (
    <div className="space-y-4">
      <FeedProfileCard profile={profile} />

      <Card className="border border-mist-100 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Quick actions</h2>
        <nav aria-label="Quick actions" className="mt-2 space-y-1">
          <Link href="#feed-composer" className={actionClass}>
            <PencilLine aria-hidden="true" className="size-4.5 text-ocean-700" />
            Post update
          </Link>
          <Link href="/community" className={actionClass}>
            <MessageCircleQuestion aria-hidden="true" className="size-4.5 text-ocean-700" />
            Ask community
          </Link>
          <Link href="/jobs" className={actionClass}>
            <BriefcaseBusiness aria-hidden="true" className="size-4.5 text-ocean-700" />
            Find a job
          </Link>
          <Link href="/network" className={actionClass}>
            <UserRoundSearch aria-hidden="true" className="size-4.5 text-ocean-700" />
            Find people
          </Link>
        </nav>
      </Card>

      {completion < 100 ? (
        <Card className="border border-mist-100 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Complete your profile</p>
              <p className="mt-1 text-sm font-semibold text-navy-950">{completion}% complete</p>
            </div>
            <span className="text-xs font-semibold text-muted">{100 - completion}% left</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-mist-100" role="progressbar" aria-label="Profile completeness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completion}>
            <div className="h-full rounded-full bg-ocean-700" style={{ width: `${completion}%` }} />
          </div>
          <p className="mt-3 text-xs leading-5 text-muted">Add more professional details when you are ready. Your basic profile is already active.</p>
          <Link href="/profile/edit" className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-mist-100 text-sm font-semibold text-navy-900 hover:border-ocean-500 hover:text-ocean-700">
            Complete profile
          </Link>
        </Card>
      ) : null}

      <Card className="border border-mist-100 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Personal shortcuts</h2>
        <nav aria-label="Personal shortcuts" className="mt-2 space-y-1">
          <Link href="/network" className={shortcutClass}>
            <span className="flex items-center gap-2.5"><Network aria-hidden="true" className="size-4 text-ocean-700" />My network</span>
          </Link>
          <Link href="/saved" className={shortcutClass}>
            <span className="flex items-center gap-2.5"><Bookmark aria-hidden="true" className="size-4 text-ocean-700" />Saved</span>
          </Link>
          <Link href="/profile" className={shortcutClass}>
            <span className="flex items-center gap-2.5"><UserRound aria-hidden="true" className="size-4 text-ocean-700" />My profile</span>
          </Link>
        </nav>
      </Card>
    </div>
  )
}
