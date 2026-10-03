import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'
import { MediaImage } from '@/components/ui/media-image'
import { GROUP_ROLE_LABELS, type GroupMember } from '../types'
import { MemberActionsMenu } from './member-actions-menu'

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'SN'
}

/** Member rows (owner, moderators, then members) with the moderator actions when the viewer moderates the group. */
export function GroupMembersList({
  groupId,
  members,
  viewerId,
  canManage,
  canTransferOwnership = false,
}: {
  groupId: string
  members: GroupMember[]
  viewerId: string
  canManage: boolean
  /** The owner sees "Transfer ownership" on other members' menus. */
  canTransferOwnership?: boolean
}) {
  return (
    <ul aria-label="Members" className="divide-y divide-mist-100">
      {members.map((member) => {
        const fallback = <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-mist-100 text-sm font-semibold text-navy-950">{initials(member.fullName)}</span>
        const roleLabel = member.role === 'member' ? null : GROUP_ROLE_LABELS[member.role]
        return (
          <li key={member.profileId} className="flex items-center gap-3 py-3">
            {member.avatarUrl ? <MediaImage avatar src={member.avatarUrl} alt="" width={44} height={44} sizes="44px" className="size-11 shrink-0 rounded-full object-cover ring-1 ring-mist-100" fallback={fallback} /> : fallback}
            <div className="min-w-0 flex-1">
              <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                {member.slug
                  ? <Link href={`/people/${member.slug}`} className="truncate font-semibold text-navy-950 hover:text-ocean-700 hover:underline">{member.fullName}</Link>
                  : <span className="truncate font-semibold text-navy-950">{member.fullName}</span>}
                {roleLabel ? <span className="shrink-0 rounded-md border border-ocean-200 bg-ocean-50 px-1.5 py-0.5 text-[11px] font-bold text-ocean-800">{roleLabel}</span> : null}
                {member.isPlatformAdmin ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[11px] font-bold text-teal-900">
                    <ShieldCheck aria-hidden="true" className="size-3" /> Sea N Shore admin
                  </span>
                ) : null}
                {member.profileId === viewerId ? <span className="shrink-0 text-xs text-muted">(you)</span> : null}
              </p>
              <p className="truncate text-sm text-muted">{member.headline || 'Maritime professional'}</p>
            </div>
            {canManage && member.role !== 'owner' && member.profileId !== viewerId ? (
              <MemberActionsMenu groupId={groupId} profileId={member.profileId} fullName={member.fullName} role={member.role} canTransferOwnership={canTransferOwnership} />
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
