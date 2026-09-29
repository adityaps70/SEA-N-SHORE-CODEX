import Link from 'next/link'
import { Lock } from 'lucide-react'
import { pluralize } from '@/lib/format'
import { groupHref, type CommunityGroup } from '../types'
import { GroupIconTile } from './group-icon-tile'
import { GroupMembershipButton } from './group-membership-button'

/** Directory card: icon tile, name, visibility, member count, one-line description and the join button. */
export function GroupCard({ group, showAction = true }: { group: CommunityGroup; showAction?: boolean }) {
  const href = groupHref(group.slug)
  return (
    <article className="flex h-full min-w-0 flex-col rounded-2xl border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)] transition hover:border-teal-200 max-md:rounded-2xl max-md:shadow-none">
      <div className="flex min-w-0 items-start gap-3">
        <Link href={href} aria-hidden="true" tabIndex={-1} className="shrink-0"><GroupIconTile icon={group.icon} /></Link>
        <div className="min-w-0 flex-1">
          <h3 className="flex min-w-0 items-center gap-1.5">
            <Link href={href} className="truncate text-[15px] font-bold text-navy-950 hover:text-ocean-700 hover:underline">{group.name}</Link>
            {group.visibility === 'private' ? <Lock aria-label="Private group" className="size-3.5 shrink-0 text-muted" /> : null}
          </h3>
          <p className="mt-0.5 text-xs font-semibold text-muted">
            {group.visibility === 'private' ? 'Private' : 'Public'} · {pluralize(group.memberCount, 'member')}
            {group.viewerMembership?.status === 'pending' ? <span className="ml-1.5 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold text-amber-900">Pending</span> : null}
          </p>
        </div>
      </div>
      {group.description ? <p className="mt-3 line-clamp-2 text-sm leading-6 text-ink">{group.description}</p> : null}
      {showAction ? (
        <div className="mt-auto pt-3">
          <GroupMembershipButton
            groupId={group.id}
            groupName={group.name}
            visibility={group.visibility}
            initialStatus={group.viewerMembership?.status ?? null}
            role={group.viewerMembership?.role ?? null}
          />
        </div>
      ) : null}
    </article>
  )
}
