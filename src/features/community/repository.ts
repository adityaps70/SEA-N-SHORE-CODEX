import type { QueryResultRow } from 'pg'
import { query as databaseQuery, type DatabaseQueryClient } from '@/lib/db/client'
import type {
  AdminCommunityGroup,
  CommunityGroup,
  GroupJoinPolicy,
  GroupMember,
  GroupRole,
  GroupSuggestionSignals,
  GroupVisibility,
  MembershipStatus,
  ViewerMembership,
} from './types'

type CommunityQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

type GroupRow = QueryResultRow & {
  id: string
  slug: string
  name: string
  description: string
  rules: string
  cover_path: string | null
  icon_path?: string | null
  icon: string | null
  visibility: GroupVisibility
  join_policy?: GroupJoinPolicy | null
  created_by: string | null
  owner_company_id?: string | null
  owner_company_slug?: string | null
  owner_company_name?: string | null
  archived_at: string | null
  member_count: number | string
  viewer_role: GroupRole | null
  viewer_status: MembershipStatus | null
}

type MemberRow = QueryResultRow & {
  profile_id: string
  slug: string | null
  full_name: string
  headline: string | null
  avatar_path: string | null
  role: GroupRole
  status: MembershipStatus
  requested_at: string
  joined_at: string | null
  is_platform_admin?: boolean | null
}

type MembershipRow = QueryResultRow & { role: GroupRole; status: MembershipStatus }
type IdRow = QueryResultRow & { id: string }
type SlugRow = QueryResultRow & { slug: string }
type PostGroupRow = QueryResultRow & { post_id: string; group_id: string | null; author_id: string }

type AdminGroupRow = QueryResultRow & {
  id: string
  slug: string
  name: string
  description: string
  rules: string
  icon: string | null
  icon_path?: string | null
  visibility: GroupVisibility
  join_policy?: GroupJoinPolicy | null
  member_count: number | string
  pending_count: number | string
  owner_id: string | null
  owner_name: string | null
  owner_slug: string | null
  owner_company_id?: string | null
  owner_company_slug?: string | null
  owner_company_name?: string | null
  archived_at: string | null
  created_at: string
}

type SignalRow = QueryResultRow & { rank: string | null; vessel_types: string[] | null; persona: string | null }
type ProfileLookupRow = QueryResultRow & { id: string; full_name: string; slug: string | null }

/**
 * Community images are served by the first-party, signed-in-only route
 * `/api/community-media/<groupId>/<cover|icon>`; the version query busts caches when the path changes.
 */
export function communityImageUrl(groupId: string, kind: 'cover' | 'icon', path: string | null | undefined) {
  if (!path?.trim()) return null
  return `/api/community-media/${groupId}/${kind}?v=${encodeURIComponent(path.split('/').at(-1) ?? path)}`
}

function mapJoinPolicy(value: string | null | undefined, visibility: GroupVisibility): GroupJoinPolicy {
  if (value === 'open' || value === 'approval') return value
  // Rows read before migration 0057 keep the round 9B behaviour: private groups need approval.
  return visibility === 'private' ? 'approval' : 'open'
}

function mapOwnerOrganization(row: { owner_company_id?: string | null; owner_company_slug?: string | null; owner_company_name?: string | null }) {
  return row.owner_company_id && row.owner_company_slug && row.owner_company_name
    ? { id: row.owner_company_id, slug: row.owner_company_slug, name: row.owner_company_name }
    : null
}

function mapGroup(row: GroupRow): CommunityGroup {
  const visibility: GroupVisibility = row.visibility === 'private' ? 'private' : 'public'
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? '',
    rules: row.rules ?? '',
    coverUrl: communityImageUrl(row.id, 'cover', row.cover_path),
    iconUrl: communityImageUrl(row.id, 'icon', row.icon_path),
    icon: row.icon,
    visibility,
    joinPolicy: mapJoinPolicy(row.join_policy, visibility),
    memberCount: Number(row.member_count ?? 0),
    archived: Boolean(row.archived_at),
    createdBy: row.created_by,
    ownerOrganization: mapOwnerOrganization(row),
    viewerMembership: row.viewer_role && row.viewer_status ? { role: row.viewer_role, status: row.viewer_status } : null,
  }
}

function mapMember(row: MemberRow): GroupMember {
  return {
    profileId: row.profile_id,
    slug: row.slug,
    fullName: row.full_name,
    headline: row.headline,
    avatarPath: row.avatar_path,
    role: row.role,
    status: row.status,
    requestedAt: row.requested_at,
    joinedAt: row.joined_at,
    isPlatformAdmin: Boolean(row.is_platform_admin),
  }
}

function mapAdminGroup(row: AdminGroupRow): AdminCommunityGroup {
  const visibility: GroupVisibility = row.visibility === 'private' ? 'private' : 'public'
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? '',
    rules: row.rules ?? '',
    icon: row.icon,
    iconUrl: communityImageUrl(row.id, 'icon', row.icon_path),
    visibility,
    joinPolicy: mapJoinPolicy(row.join_policy, visibility),
    memberCount: Number(row.member_count ?? 0),
    pendingCount: Number(row.pending_count ?? 0),
    owner: row.owner_id && row.owner_name ? { id: row.owner_id, fullName: row.owner_name, slug: row.owner_slug } : null,
    ownerOrganization: mapOwnerOrganization(row),
    archivedAt: row.archived_at,
    createdAt: row.created_at,
  }
}

/** Escapes `%`, `_` and `\` so a member's search text is matched literally by `ilike`. */
function likePattern(search: string) {
  return `%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`
}

/** `$1` must be the viewer's profile id. */
const GROUP_SELECT = `
  select g.id, g.slug, g.name, g.description, g.rules, g.cover_path, g.icon_path, g.icon, g.visibility, g.join_policy, g.created_by, g.archived_at,
         g.owner_company_id, owner_company.slug as owner_company_slug, owner_company.name as owner_company_name,
         (select count(*) from public.community_group_memberships c where c.group_id = g.id and c.status = 'active') as member_count,
         vm.role as viewer_role,
         vm.status as viewer_status
  from public.community_groups g
  left join public.companies owner_company on owner_company.id = g.owner_company_id
  left join public.community_group_memberships vm on vm.group_id = g.id and vm.profile_id = $1
`

/** Public groups first, then private ones; each block alphabetical. */
const DIRECTORY_ORDER = `order by case when g.visibility = 'public' then 0 else 1 end, lower(g.name), g.id`

/** Owner, then admins, then members; alphabetical within a role. */
const MEMBER_ORDER = `order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, lower(p.full_name), p.id`

const MEMBER_SELECT = `
  select m.profile_id, p.slug, p.full_name, p.headline, p.avatar_path, m.role, m.status, m.requested_at, m.joined_at,
         exists (select 1 from public.user_roles ur where ur.user_id = m.profile_id and ur.role::text = 'administrator') as is_platform_admin
  from public.community_group_memberships m
  join public.profiles p on p.id = m.profile_id
`

export function createCommunityRepository(input: { query?: CommunityQuery } = {}) {
  const queryRows: CommunityQuery = input.query ?? ((text, values) => databaseQuery(text, values))

  /** Live groups for the directory; `search` matches the name or description. */
  async function listDirectory(viewerId: string, options: { search?: string; limit?: number } = {}) {
    const search = options.search?.trim() ?? ''
    const limit = options.limit ?? 100
    const rows = await queryRows(
      `${GROUP_SELECT}
       where g.archived_at is null
         ${search ? `and (g.name ilike $3 escape '\\' or g.description ilike $3 escape '\\')` : ''}
       ${DIRECTORY_ORDER}
       limit $2`,
      search ? [viewerId, limit, likePattern(search)] : [viewerId, limit],
    ) as GroupRow[]
    return rows.map(mapGroup)
  }

  /** Groups the viewer belongs to or has asked to join (live groups only). */
  async function listViewerGroups(viewerId: string) {
    const rows = await queryRows(
      `${GROUP_SELECT}
       where g.archived_at is null
         and vm.status in ('active', 'pending')
       order by case when vm.status = 'active' then 0 else 1 end, lower(g.name), g.id`,
      [viewerId],
    ) as GroupRow[]
    return rows.map(mapGroup)
  }

  /** Live groups by slug, in the order requested (directory suggestions). */
  async function listBySlugs(viewerId: string, slugs: string[]) {
    if (!slugs.length) return []
    const rows = await queryRows(
      `${GROUP_SELECT}
       where g.archived_at is null and g.slug = any($2::text[])`,
      [viewerId, slugs],
    ) as GroupRow[]
    const bySlug = new Map(rows.map((row) => [row.slug, mapGroup(row)] as const))
    return slugs.flatMap((slug) => {
      const group = bySlug.get(slug)
      return group ? [group] : []
    })
  }

  /** Global search: live groups whose name or description matches. */
  async function searchGroups(viewerId: string, search: string, limit = 20) {
    const trimmed = search.trim()
    if (!trimmed) return []
    const rows = await queryRows(
      `${GROUP_SELECT}
       where g.archived_at is null
         and (g.name ilike $3 escape '\\' or g.description ilike $3 escape '\\')
       order by case when g.name ilike $3 escape '\\' then 0 else 1 end, ${DIRECTORY_ORDER.replace('order by ', '')}
       limit $2`,
      [viewerId, limit, likePattern(trimmed)],
    ) as GroupRow[]
    return rows.map(mapGroup)
  }

  /** A group by slug with the viewer's membership; archived groups are returned with `archived: true`. */
  async function getBySlug(viewerId: string, slug: string) {
    const rows = await queryRows(`${GROUP_SELECT} where g.slug = $2 limit 1`, [viewerId, slug]) as GroupRow[]
    return rows[0] ? mapGroup(rows[0]) : null
  }

  async function getById(viewerId: string, groupId: string) {
    const rows = await queryRows(`${GROUP_SELECT} where g.id = $2 limit 1`, [viewerId, groupId]) as GroupRow[]
    return rows[0] ? mapGroup(rows[0]) : null
  }

  async function getMembership(groupId: string, profileId: string): Promise<ViewerMembership | null> {
    const rows = await queryRows(
      `select role, status from public.community_group_memberships where group_id = $1 and profile_id = $2 limit 1`,
      [groupId, profileId],
    ) as MembershipRow[]
    return rows[0] ? { role: rows[0].role, status: rows[0].status } : null
  }

  /** Active members: owner, admins, then members; `search` matches name or headline. */
  async function listMembers(groupId: string, options: { search?: string; limit?: number; adminsOnly?: boolean } = {}) {
    const search = options.search?.trim() ?? ''
    const limit = options.limit ?? 200
    const values: unknown[] = [groupId, limit]
    if (search) values.push(likePattern(search))
    const rows = await queryRows(
      `${MEMBER_SELECT}
       where m.group_id = $1
         and m.status = 'active'
         and p.account_status = 'active'
         ${options.adminsOnly ? `and m.role in ('admin', 'owner')` : ''}
         ${search ? `and (p.full_name ilike $3 escape '\\' or p.headline ilike $3 escape '\\')` : ''}
       ${MEMBER_ORDER}
       limit $2`,
      values,
    ) as MemberRow[]
    return rows.map(mapMember)
  }

  /** Members waiting for approval (private groups), oldest request first. */
  async function listPendingRequests(groupId: string) {
    const rows = await queryRows(
      `${MEMBER_SELECT}
       where m.group_id = $1 and m.status = 'pending' and p.account_status = 'active'
       order by m.requested_at asc, p.id`,
      [groupId],
    ) as MemberRow[]
    return rows.map(mapMember)
  }

  async function countPendingRequests(groupId: string) {
    const rows = await queryRows(
      `select count(*)::int as count from public.community_group_memberships where group_id = $1 and status = 'pending'`,
      [groupId],
    ) as Array<QueryResultRow & { count: number | string }>
    return Number(rows[0]?.count ?? 0)
  }

  /**
   * Joins (public) or asks to join (private): inserts the membership, or revives a row the
   * member left or that was declined. Existing active/pending/removed rows are left as they are.
   */
  async function upsertJoin(groupId: string, profileId: string, status: 'active' | 'pending') {
    const rows = await queryRows(
      `insert into public.community_group_memberships (group_id, profile_id, role, status, requested_at, joined_at)
       values ($1, $2, 'member', $3, now(), case when $3 = 'active' then now() else null end)
       on conflict (group_id, profile_id) do nothing
       returning status`,
      [groupId, profileId, status],
    ) as Array<QueryResultRow & { status: MembershipStatus }>
    return rows.length === 1
  }

  /** Leaving (or withdrawing a request) deletes the row so the member can join again later. */
  async function deleteMembership(groupId: string, profileId: string) {
    const rows = await queryRows(
      `delete from public.community_group_memberships
       where group_id = $1 and profile_id = $2 and role <> 'owner'
       returning profile_id`,
      [groupId, profileId],
    )
    return rows.length === 1
  }

  async function approveRequest(groupId: string, profileId: string) {
    const rows = await queryRows(
      `update public.community_group_memberships
       set status = 'active', joined_at = now(), updated_at = now()
       where group_id = $1 and profile_id = $2 and status = 'pending'
       returning profile_id`,
      [groupId, profileId],
    )
    return rows.length === 1
  }

  /** Approves every pending request of a group; returns the approved profile ids (for notifications). */
  async function approveAllRequests(groupId: string) {
    const rows = await queryRows(
      `update public.community_group_memberships
       set status = 'active', joined_at = now(), updated_at = now()
       where group_id = $1 and status = 'pending'
       returning profile_id as id`,
      [groupId],
    ) as IdRow[]
    return rows.map((row) => row.id)
  }

  /**
   * Sea N Shore administrators join at once whatever the join setting: inserts an active
   * membership, or revives a left/declined/removed row, keeping an existing owner/moderator role.
   */
  async function activateMembership(groupId: string, profileId: string) {
    await queryRows(
      `insert into public.community_group_memberships (group_id, profile_id, role, status, requested_at, joined_at)
       values ($1, $2, 'member', 'active', now(), now())
       on conflict (group_id, profile_id) do update
         set status = 'active', joined_at = coalesce(public.community_group_memberships.joined_at, now()), updated_at = now()`,
      [groupId, profileId],
    )
  }

  async function declineRequest(groupId: string, profileId: string) {
    const rows = await queryRows(
      `delete from public.community_group_memberships
       where group_id = $1 and profile_id = $2 and status = 'pending'
       returning profile_id`,
      [groupId, profileId],
    )
    return rows.length === 1
  }

  /** Removed members keep a row with status 'removed' so they cannot simply rejoin. */
  async function removeMember(groupId: string, profileId: string) {
    const rows = await queryRows(
      `update public.community_group_memberships
       set status = 'removed', role = 'member', updated_at = now()
       where group_id = $1 and profile_id = $2 and status = 'active' and role <> 'owner'
       returning profile_id`,
      [groupId, profileId],
    )
    return rows.length === 1
  }

  async function setMemberRole(groupId: string, profileId: string, role: 'member' | 'admin') {
    const rows = await queryRows(
      `update public.community_group_memberships
       set role = $3, updated_at = now()
       where group_id = $1 and profile_id = $2 and status = 'active' and role <> 'owner'
       returning profile_id`,
      [groupId, profileId, role],
    )
    return rows.length === 1
  }

  /** Platform admin: the current owner becomes an admin and the chosen member the (active) owner. */
  async function setOwner(groupId: string, profileId: string) {
    await queryRows(
      `update public.community_group_memberships
       set role = 'admin', updated_at = now()
       where group_id = $1 and role = 'owner' and profile_id <> $2`,
      [groupId, profileId],
    )
    await queryRows(
      `insert into public.community_group_memberships (group_id, profile_id, role, status, requested_at, joined_at)
       values ($1, $2, 'owner', 'active', now(), now())
       on conflict (group_id, profile_id) do update
         set role = 'owner', status = 'active', joined_at = coalesce(public.community_group_memberships.joined_at, now()), updated_at = now()`,
      [groupId, profileId],
    )
  }

  /** Slugs already used that start with `base` (for `uniqueGroupSlug`). */
  async function listSlugsLike(base: string) {
    const rows = await queryRows(
      `select slug from public.community_groups where slug = $1 or slug like $2 escape '\\'`,
      [base, `${base.replace(/[\\%_]/g, (character) => `\\${character}`)}-%`],
    ) as SlugRow[]
    return rows.map((row) => row.slug)
  }

  async function createGroup(input: {
    name: string
    slug: string
    description: string
    rules: string
    visibility: GroupVisibility
    icon: string | null
    joinPolicy?: GroupJoinPolicy
    createdBy: string
    ownerId: string
    /** Organization Pro: the organization that owns the community. */
    ownerCompanyId?: string | null
  }) {
    const rows = await queryRows(
      `insert into public.community_groups (name, slug, description, rules, icon, visibility, join_policy, created_by, owner_company_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id`,
      [input.name, input.slug, input.description, input.rules, input.icon, input.visibility, input.joinPolicy ?? (input.visibility === 'private' ? 'approval' : 'open'), input.createdBy, input.ownerCompanyId ?? null],
    ) as IdRow[]
    const groupId = rows[0]?.id
    if (!groupId) throw new Error('community_group_create_failed')
    await queryRows(
      `insert into public.community_group_memberships (group_id, profile_id, role, status, requested_at, joined_at)
       values ($1, $2, 'owner', 'active', now(), now())
       on conflict (group_id, profile_id) do update set role = 'owner', status = 'active', joined_at = coalesce(public.community_group_memberships.joined_at, now()), updated_at = now()`,
      [groupId, input.ownerId],
    )
    return groupId
  }

  async function updateGroup(groupId: string, input: {
    name: string
    description: string
    rules: string
    visibility: GroupVisibility
    icon: string | null
    joinPolicy?: GroupJoinPolicy
  }) {
    const rows = await queryRows(
      `update public.community_groups
       set name = $2, description = $3, rules = $4, visibility = $5, icon = $6, join_policy = coalesce($7, join_policy), updated_at = now()
       where id = $1
       returning id`,
      [groupId, input.name, input.description, input.rules, input.visibility, input.icon, input.joinPolicy ?? null],
    ) as IdRow[]
    return rows.length === 1
  }

  /** Live communities a member owns personally (organization-owned ones count for the organization). */
  async function countLiveGroupsOwnedByMember(profileId: string) {
    const rows = await queryRows(
      `select count(*)::int as count
       from public.community_groups g
       where g.archived_at is null and g.owner_company_id is null
         and exists (select 1 from public.community_group_memberships m where m.group_id = g.id and m.profile_id = $1 and m.role = 'owner' and m.status = 'active')`,
      [profileId],
    ) as Array<QueryResultRow & { count: number | string }>
    return Number(rows[0]?.count ?? 0)
  }

  async function countLiveGroupsOwnedByOrganization(companyId: string) {
    const rows = await queryRows(
      `select count(*)::int as count from public.community_groups g where g.archived_at is null and g.owner_company_id = $1`,
      [companyId],
    ) as Array<QueryResultRow & { count: number | string }>
    return Number(rows[0]?.count ?? 0)
  }

  async function setArchived(groupId: string, archived: boolean) {
    const rows = await queryRows(
      archived
        ? `update public.community_groups set archived_at = coalesce(archived_at, now()), updated_at = now() where id = $1 returning id`
        : `update public.community_groups set archived_at = null, updated_at = now() where id = $1 returning id`,
      [groupId],
    ) as IdRow[]
    return rows.length === 1
  }

  /** Site admin: every group, live ones first, newest first within each block. */
  async function listAdminGroups(options: { search?: string; archived?: 'all' | 'live' | 'archived' } = {}) {
    const search = options.search?.trim() ?? ''
    const archived = options.archived ?? 'all'
    const values: unknown[] = []
    if (search) values.push(likePattern(search))
    const rows = await queryRows(
      `select g.id, g.slug, g.name, g.description, g.rules, g.icon, g.icon_path, g.visibility, g.join_policy, g.archived_at, g.created_at,
              g.owner_company_id, owner_company.slug as owner_company_slug, owner_company.name as owner_company_name,
              (select count(*) from public.community_group_memberships c where c.group_id = g.id and c.status = 'active') as member_count,
              (select count(*) from public.community_group_memberships c where c.group_id = g.id and c.status = 'pending') as pending_count,
              owner.id as owner_id, owner.full_name as owner_name, owner.slug as owner_slug
       from public.community_groups g
       left join public.companies owner_company on owner_company.id = g.owner_company_id
       left join lateral (
         select p.id, p.full_name, p.slug
         from public.community_group_memberships om
         join public.profiles p on p.id = om.profile_id
         where om.group_id = g.id and om.role = 'owner' and om.status = 'active'
         order by om.joined_at asc nulls last
         limit 1
       ) owner on true
       where true
         ${archived === 'live' ? 'and g.archived_at is null' : archived === 'archived' ? 'and g.archived_at is not null' : ''}
         ${search ? `and (g.name ilike $1 escape '\\' or g.slug ilike $1 escape '\\')` : ''}
       order by (g.archived_at is not null), g.created_at desc, g.id`,
      values,
    ) as AdminGroupRow[]
    return rows.map(mapAdminGroup)
  }

  /** Live groups the viewer administers (admin or owner), for post moderation in feeds. */
  async function listAdministeredGroupIds(viewerId: string) {
    const rows = await queryRows(
      `select m.group_id as id
       from public.community_group_memberships m
       join public.community_groups g on g.id = m.group_id
       where m.profile_id = $1 and m.status = 'active' and m.role in ('admin', 'owner') and g.archived_at is null`,
      [viewerId],
    ) as IdRow[]
    return rows.map((row) => row.id)
  }

  /** Profile ids of a group's active admins and owners (notification recipients). */
  async function listAdminIds(groupId: string) {
    const rows = await queryRows(
      `select m.profile_id as id
       from public.community_group_memberships m
       join public.profiles admin on admin.id = m.profile_id
       where m.group_id = $1 and m.status = 'active' and m.role in ('admin', 'owner') and admin.account_status = 'active'`,
      [groupId],
    ) as IdRow[]
    return rows.map((row) => row.id)
  }

  /** The group a live post belongs to, or null when it is an open-feed post. */
  async function getPostGroup(postId: string) {
    const rows = await queryRows(
      `select p.id as post_id, p.group_id, p.author_id from public.posts p where p.id = $1 and p.deleted_at is null limit 1`,
      [postId],
    ) as PostGroupRow[]
    const row = rows[0]
    if (!row) return null
    return { postId: row.post_id, groupId: row.group_id, authorId: row.author_id }
  }

  /** Soft-deletes a group post the way organization admins delete organization posts. */
  async function softDeleteGroupPost(actorId: string, postId: string, groupId: string) {
    const rows = await queryRows(
      `update public.posts
       set deleted_at = now(),
           deleted_by = $1,
           deletion_reason = 'Removed by a group admin.',
           purge_after = now() + interval '30 days',
           updated_at = now()
       where id = $2
         and group_id = $3
         and deleted_at is null
       returning id`,
      [actorId, postId, groupId],
    ) as IdRow[]
    if (rows.length !== 1) return false
    await queryRows(
      `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
       values ($1, 'content.post_deleted_by_group_admin', 'post', $2, jsonb_build_object('group_id', $3::text))`,
      [actorId, postId, groupId],
    )
    return true
  }

  async function insertAuditEvent(actorId: string, action: string, groupId: string, metadata: Record<string, unknown> = {}) {
    await queryRows(
      `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
       values ($1, $2, 'group', $3, $4::jsonb)`,
      [actorId, action, groupId, JSON.stringify(metadata)],
    )
  }

  /** Same upsert as the feed social writer, so a repeated request refreshes one notification. */
  async function upsertNotification(input: {
    recipientId: string
    actorId: string
    type: 'group_join_request' | 'group_join_approved'
    groupId: string
    dedupeKey: string
  }) {
    await queryRows(
      `insert into public.notifications (recipient_id, actor_id, notification_type, dedupe_key, group_id)
       values ($1, $2, $3, $4, $5)
       on conflict (recipient_id, dedupe_key) where dedupe_key is not null
       do update set actor_id = excluded.actor_id, notification_type = excluded.notification_type, group_id = excluded.group_id, created_at = now(), read_at = null`,
      [input.recipientId, input.actorId, input.type, input.dedupeKey, input.groupId],
    )
  }

  async function deleteNotification(recipientId: string, dedupeKey: string) {
    await queryRows(`delete from public.notifications where recipient_id = $1 and dedupe_key = $2`, [recipientId, dedupeKey])
  }

  /** Rank, vessel types and persona for group suggestions. */
  async function getSuggestionSignals(viewerId: string): Promise<GroupSuggestionSignals> {
    const rows = await queryRows(
      `select mp.rank, mp.vessel_types, p.persona
       from public.profiles p
       left join public.maritime_profiles mp on mp.user_id = p.id
       where p.id = $1
       limit 1`,
      [viewerId],
    ) as SignalRow[]
    const row = rows[0]
    return { rank: row?.rank ?? null, vesselTypes: row?.vessel_types ?? [], persona: row?.persona ?? null }
  }

  /** Site admin owner picker: an active member by sign-in email or profile handle. */
  async function findProfileByEmailOrSlug(value: string) {
    const needle = value.trim().replace(/^@/, '').toLowerCase()
    if (!needle) return null
    const rows = await queryRows(
      `select p.id, p.full_name, p.slug
       from public.profiles p
       where p.account_status = 'active'
         and (
           lower(p.slug) = $1
           or exists (select 1 from public.identity_accounts ia where ia.profile_id = p.id and lower(ia.email) = $1)
         )
       limit 1`,
      [needle],
    ) as ProfileLookupRow[]
    const row = rows[0]
    return row ? { id: row.id, fullName: row.full_name, slug: row.slug } : null
  }

  /**
   * Round 9C community images: swaps the banner (`cover_path`) or photo (`icon_path`) and returns
   * the previous key so the media service can delete the old object. Archived groups are updated
   * too (site admins tidy them up). Throws when the group does not exist.
   */
  async function replaceImagePath(groupId: string, kind: 'cover' | 'icon', nextPath: string | null): Promise<string | null> {
    const column = kind === 'cover' ? 'cover_path' : 'icon_path'
    const rows = await queryRows(
      `with current as (
         select ${column} as previous_path
         from public.community_groups
         where id = $1
         for update
       )
       update public.community_groups g
       set ${column} = $2,
           updated_at = now()
       from current
       where g.id = $1
       returning current.previous_path`,
      [groupId, nextPath],
    ) as Array<QueryResultRow & { previous_path: string | null }>
    if (rows.length !== 1) throw new Error('community_group_missing')
    return rows[0]?.previous_path ?? null
  }

  /** The stored banner and photo keys of a group (archived groups included), or null when it does not exist. */
  async function getImagePaths(groupId: string): Promise<{ coverPath: string | null; iconPath: string | null } | null> {
    const rows = await queryRows(
      `select cover_path, icon_path from public.community_groups where id = $1 limit 1`,
      [groupId],
    ) as Array<QueryResultRow & { cover_path: string | null; icon_path: string | null }>
    const row = rows[0]
    return row ? { coverPath: row.cover_path ?? null, iconPath: row.icon_path ?? null } : null
  }

  return {
    listDirectory,
    listViewerGroups,
    listBySlugs,
    searchGroups,
    getBySlug,
    getById,
    getMembership,
    replaceImagePath,
    getImagePaths,
    listMembers,
    listPendingRequests,
    countPendingRequests,
    upsertJoin,
    deleteMembership,
    approveRequest,
    approveAllRequests,
    activateMembership,
    declineRequest,
    removeMember,
    setMemberRole,
    setOwner,
    listSlugsLike,
    createGroup,
    updateGroup,
    countLiveGroupsOwnedByMember,
    countLiveGroupsOwnedByOrganization,
    setArchived,
    listAdminGroups,
    listAdministeredGroupIds,
    listAdminIds,
    getPostGroup,
    softDeleteGroupPost,
    insertAuditEvent,
    upsertNotification,
    deleteNotification,
    getSuggestionSignals,
    findProfileByEmailOrSlug,
  }
}

export type CommunityRepository = ReturnType<typeof createCommunityRepository>

export function createCommunityRepositoryForClient(client: DatabaseQueryClient) {
  return createCommunityRepository({ query: async (text, values) => (await client.query(text, values)).rows })
}

export const communityRepository = createCommunityRepository()
