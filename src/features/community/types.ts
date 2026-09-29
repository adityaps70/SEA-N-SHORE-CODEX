/** Community groups (round 9B): `public.community_groups` and `public.community_group_memberships`. */

export const GROUP_ROLES = ['member', 'admin', 'owner'] as const
export type GroupRole = (typeof GROUP_ROLES)[number]

export const MEMBERSHIP_STATUSES = ['active', 'pending', 'removed'] as const
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number]

export const GROUP_VISIBILITIES = ['public', 'private'] as const
export type GroupVisibility = (typeof GROUP_VISIBILITIES)[number]

/** Icon names stored on `community_groups.icon`; each maps to a lucide icon in `group-icons.ts`. */
export const GROUP_ICON_NAMES = ['ShieldCheck', 'UsersRound', 'Wrench', 'BookOpenCheck', 'BadgeQuestionMark'] as const
export type GroupIconName = (typeof GROUP_ICON_NAMES)[number]

export const GROUP_NAME_MAX_LENGTH = 80
export const GROUP_SLUG_MAX_LENGTH = 80
export const GROUP_DESCRIPTION_MAX_LENGTH = 2000
export const GROUP_RULES_MAX_LENGTH = 4000

export type ViewerMembership = {
  role: GroupRole
  status: MembershipStatus
}

export type CommunityGroup = {
  id: string
  slug: string
  name: string
  description: string
  rules: string
  coverUrl: string | null
  icon: string | null
  visibility: GroupVisibility
  /** Active members, including admins and the owner. */
  memberCount: number
  archived: boolean
  createdBy: string | null
  /** The signed-in viewer's membership row, or null when they never joined (or left). */
  viewerMembership: ViewerMembership | null
}

export type GroupMember = {
  profileId: string
  slug: string | null
  fullName: string
  headline: string | null
  avatarPath: string | null
  avatarUrl?: string | null
  role: GroupRole
  status: MembershipStatus
  requestedAt: string
  joinedAt: string | null
}

/** A row of the site-admin Communities list. */
export type AdminCommunityGroup = {
  id: string
  slug: string
  name: string
  description: string
  rules: string
  icon: string | null
  visibility: GroupVisibility
  memberCount: number
  pendingCount: number
  owner: { id: string; fullName: string; slug: string | null } | null
  archivedAt: string | null
  createdAt: string
}

/** Signals used to suggest groups to a member (see `suggestions.ts`). */
export type GroupSuggestionSignals = {
  rank: string | null
  vesselTypes: string[]
  persona: string | null
}

/** What the viewer may do on a group page, decided on the server. */
export function isGroupAdminRole(role: GroupRole | null | undefined) {
  return role === 'admin' || role === 'owner'
}

export function viewerAdministersGroup(group: Pick<CommunityGroup, 'viewerMembership'>) {
  return group.viewerMembership?.status === 'active' && isGroupAdminRole(group.viewerMembership.role)
}

export function viewerIsActiveMember(group: Pick<CommunityGroup, 'viewerMembership'>) {
  return group.viewerMembership?.status === 'active'
}

/** Posts and members of a private group are visible to active members only. */
export function viewerCanSeeGroupContent(group: Pick<CommunityGroup, 'visibility' | 'viewerMembership'>) {
  return group.visibility === 'public' || viewerIsActiveMember(group)
}

export function groupHref(slug: string) {
  return `/community/${slug}`
}

export const GROUP_PAGE_TABS = [
  { id: 'about', label: 'About' },
  { id: 'posts', label: 'Posts' },
  { id: 'members', label: 'Members' },
] as const

export type GroupPageTab = (typeof GROUP_PAGE_TABS)[number]['id']

export function parseGroupPageTab(value: string | string[] | undefined, fallback: GroupPageTab): GroupPageTab {
  const first = Array.isArray(value) ? value[0] : value
  return GROUP_PAGE_TABS.find((tab) => tab.id === first)?.id ?? fallback
}

export function groupTabHref(slug: string, tab: GroupPageTab) {
  return `${groupHref(slug)}?tab=${tab}`
}
