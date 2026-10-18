import Link from 'next/link'
import { Lock, UsersRound } from 'lucide-react'
import { pluralize } from '@/lib/format'
import { COMMUNITY_CATEGORY_ICONS, GroupIcon } from '../group-icons'
import { COMMUNITY_CATEGORIES, COMMUNITY_CATEGORY_LABELS, UNCATEGORISED_COMMUNITIES, communityCategoryFilterLabel, groupHref, type CommunityCategoryFilter, type CommunityGroup } from '../types'
import { GroupCover, GroupIconTile } from './group-icon-tile'
import { GroupMembershipButton } from './group-membership-button'

/** "/community?…" with only the parameters that are set. */
export function communityHref(params: Record<string, string | number | null | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') search.set(key, String(value))
  }
  const query = search.toString()
  return `/community${query ? `?${query}` : ''}`
}

function RoleChip({ group }: { group: CommunityGroup }) {
  const membership = group.viewerMembership
  if (membership?.status === 'pending') {
    return <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-bold text-amber-900">Pending</span>
  }
  if (membership?.status === 'active' && membership.role !== 'member') {
    return <span className="rounded-md bg-ocean-50 px-1.5 py-0.5 text-xs font-bold text-ocean-800">{membership.role === 'owner' ? 'Owner' : 'Moderator'}</span>
  }
  return null
}

/** One line of activity: "12 members · 3 posts this week". */
function activityLine(group: CommunityGroup) {
  const parts = [pluralize(group.memberCount, 'member')]
  if (group.recentPostCount) parts.push(`${pluralize(group.recentPostCount, 'post')} this week`)
  return parts.join(' · ')
}

/**
 * Round H (H7): "Your communities" lists joined communities and pending requests together; the line under the
 * heading counts them separately so the total is not mistaken for communities joined.
 */
export function yourCommunitiesSummary(mine: CommunityGroup[]) {
  const pending = mine.filter((group) => group.viewerMembership?.status === 'pending').length
  const joined = mine.length - pending
  if (!mine.length) return 'Communities you belong to, and requests waiting for a moderator.'
  const parts = [`You belong to ${pluralize(joined, 'community', 'communities')}`]
  if (pending) parts.push(`${pluralize(pending, 'request')} waiting for a moderator`)
  return `${parts.join(' · ')}.`
}

/**
 * Compact row for "Your communities" and "Popular this week" (LinkedIn Groups' left list): photo,
 * name, activity and, for groups the member has not joined, the join button.
 */
export function CommunityListRow({ group, showAction = false }: { group: CommunityGroup; showAction?: boolean }) {
  const href = groupHref(group.slug)
  const fresh = Boolean(group.recentPostCount) && group.viewerMembership?.status === 'active'
  return (
    <div className="flex min-w-0 items-center gap-3 py-2.5">
      <Link href={href} aria-hidden="true" tabIndex={-1} className="relative shrink-0">
        <GroupIconTile icon={group.icon} iconUrl={group.iconUrl} size="sm" />
        {fresh ? <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-white bg-teal-500" aria-hidden="true" /> : null}
      </Link>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5">
          <Link href={href} className="truncate text-sm font-bold text-navy-950 hover:text-ocean-700 hover:underline">{group.name}</Link>
          {group.visibility === 'private' ? <Lock aria-label="Private group" className="size-3 shrink-0 text-muted" /> : null}
          <RoleChip group={group} />
        </p>
        <p className="truncate text-xs text-muted" title={fresh ? 'New posts this week' : undefined}>{activityLine(group)}</p>
      </div>
      {showAction ? (
        <GroupMembershipButton
          groupId={group.id}
          groupName={group.name}
          visibility={group.visibility}
          joinPolicy={group.joinPolicy}
          initialStatus={group.viewerMembership?.status ?? null}
          role={group.viewerMembership?.role ?? null}
          className="shrink-0"
        />
      ) : null}
    </div>
  )
}

/** "Suggested for you" card: banner, photo over the banner, name, category, members, description and join. */
export function CommunityDiscoverCard({ group, reason = null }: { group: CommunityGroup; reason?: string | null }) {
  const href = groupHref(group.slug)
  return (
    <article className="flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-mist-100 bg-white shadow-[var(--shadow-card)] transition hover:border-teal-200 max-md:shadow-none">
      <Link href={href} aria-hidden="true" tabIndex={-1}>
        <GroupCover coverUrl={group.coverUrl} name={group.name} className="h-16" />
      </Link>
      <div className="flex flex-1 flex-col px-4 pb-4">
        <Link href={href} aria-hidden="true" tabIndex={-1} className="-mt-6 w-fit">
          <GroupIconTile icon={group.icon} iconUrl={group.iconUrl} className="border-2 border-white shadow-sm" />
        </Link>
        <h3 className="mt-2 flex min-w-0 items-center gap-1.5">
          <Link href={href} className="line-clamp-2 text-[15px] font-bold leading-5 text-navy-950 hover:text-ocean-700 hover:underline">{group.name}</Link>
          {group.visibility === 'private' ? <Lock aria-label="Private group" className="size-3.5 shrink-0 text-muted" /> : null}
        </h3>
        <p className="mt-0.5 text-xs font-semibold text-muted">
          {group.category ? `${COMMUNITY_CATEGORY_LABELS[group.category]} · ` : ''}{pluralize(group.memberCount, 'member')}
        </p>
        {reason ? <p className="mt-1 text-xs font-semibold text-ocean-800">{reason}</p> : null}
        {group.description ? <p className="mt-2 line-clamp-2 text-sm leading-5 text-ink">{group.description}</p> : null}
        <div className="mt-auto pt-3">
          <GroupMembershipButton
            groupId={group.id}
            groupName={group.name}
            visibility={group.visibility}
            joinPolicy={group.joinPolicy}
            initialStatus={group.viewerMembership?.status ?? null}
            role={group.viewerMembership?.role ?? null}
            className="w-full justify-center"
          />
        </div>
      </div>
    </article>
  )
}

/**
 * "Browse by category": one tile per category with how many live communities it has. Round H (H7): empty
 * categories are left out, and communities without a category get an "Other topics" tile, so the tiles add
 * up to every live community.
 */
export function CommunityCategoryGrid({ counts }: { counts: Partial<Record<CommunityCategoryFilter, number>> }) {
  const tiles = ([...COMMUNITY_CATEGORIES, UNCATEGORISED_COMMUNITIES] as CommunityCategoryFilter[]).filter((category) => (counts[category] ?? 0) > 0)
  if (!tiles.length) return null
  return (
    <ul aria-label="Community categories" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tiles.map((category) => (
        <li key={category} className="min-w-0">
          <Link
            href={communityHref({ view: 'all', category })}
            className="flex min-h-14 min-w-0 items-center gap-2.5 rounded-xl border border-mist-200 bg-white px-3 py-2 transition hover:border-ocean-200 hover:bg-ocean-50"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-mist-50 text-ocean-700">
              {category === UNCATEGORISED_COMMUNITIES
                ? <UsersRound aria-hidden="true" className="size-4" />
                : <GroupIcon icon={COMMUNITY_CATEGORY_ICONS[category]} aria-hidden="true" className="size-4" />}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-navy-950">{communityCategoryFilterLabel(category)}</span>
              <span className="block text-xs text-muted">{pluralize(counts[category] ?? 0, 'community', 'communities')}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
