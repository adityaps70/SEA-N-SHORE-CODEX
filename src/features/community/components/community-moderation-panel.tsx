import Link from '@/components/navigation/intent-link'
import { ChevronRight, Settings2, ShieldCheck, UserCheck, UsersRound } from 'lucide-react'
import { pluralize } from '@/lib/format'

/**
 * Round H (H7): one place for a community's owner and moderators to find the moderation tools that exist:
 * join requests (with how many wait), member management (moderator roles, removal, ownership) and the group
 * settings. Removing a post is in the "…" menu on each post in the community. Pinning posts and muting
 * members do not exist yet, so they are not offered.
 */
export function CommunityModerationPanel({
  pendingCount,
  requestsHref,
  membersHref,
  editHref,
  approvalRequired,
}: {
  pendingCount: number
  requestsHref: string
  membersHref: string
  editHref: string
  approvalRequired: boolean
}) {
  const linkClass = 'flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-navy-950 transition hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500'
  return (
    <section aria-labelledby="community-moderation-heading" className="rounded-2xl border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)] max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:shadow-none">
      <h2 id="community-moderation-heading" className="flex items-center gap-2 text-base font-bold text-navy-950">
        <ShieldCheck aria-hidden="true" className="size-5 text-ocean-700" />
        Moderation
      </h2>
      <ul className="mt-2 grid gap-1 sm:grid-cols-3">
        {approvalRequired || pendingCount > 0 ? (
          <li>
            <Link href={requestsHref} scroll={false} className={linkClass}>
              <UserCheck aria-hidden="true" className="size-4 shrink-0 text-ocean-700" />
              <span className="min-w-0 flex-1">
                Join requests
                <span className="block text-xs font-normal text-muted">{pendingCount ? `${pluralize(pendingCount, 'request')} waiting` : 'None waiting'}</span>
              </span>
              {pendingCount ? <span aria-hidden="true" className="grid min-w-6 place-items-center rounded-full bg-navy-950 px-1.5 text-xs font-bold text-white">{pendingCount}</span> : null}
              <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted" />
            </Link>
          </li>
        ) : null}
        <li>
          <Link href={membersHref} scroll={false} className={linkClass}>
            <UsersRound aria-hidden="true" className="size-4 shrink-0 text-ocean-700" />
            <span className="min-w-0 flex-1">
              Manage members
              <span className="block text-xs font-normal text-muted">Moderators, removal and ownership</span>
            </span>
            <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted" />
          </Link>
        </li>
        <li>
          <Link href={editHref} scroll={false} className={linkClass}>
            <Settings2 aria-hidden="true" className="size-4 shrink-0 text-ocean-700" />
            <span className="min-w-0 flex-1">
              Group settings
              <span className="block text-xs font-normal text-muted">Join setting, rules and description</span>
            </span>
            <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted" />
          </Link>
        </li>
      </ul>
      <p className="mt-2 px-3 text-xs leading-5 text-muted">To remove a post, open the “…” menu on the post and choose Remove from group.</p>
    </section>
  )
}
