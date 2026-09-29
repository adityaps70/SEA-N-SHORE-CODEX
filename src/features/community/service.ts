import { canAccessPlatformAdmin as canAccessPlatformAdminDefault } from '@/features/admin/access'
import { communityRepository, type CommunityRepository } from './repository'
import { groupSlugFromName, uniqueGroupSlug } from './slug'
import { suggestedGroupSlugs } from './suggestions'
import {
  isGroupAdminRole,
  type CommunityGroup,
  type GroupJoinPolicy,
  type GroupVisibility,
  type MembershipStatus,
} from './types'

export type CommunityServiceErrorCode =
  | 'group_not_found'
  | 'group_archived'
  | 'group_join_blocked'
  | 'group_forbidden'
  | 'group_owner_only'
  | 'group_owner_protected'
  | 'group_self_action'
  | 'group_member_not_found'
  | 'group_post_not_found'
  | 'group_owner_not_found'

export class CommunityServiceError extends Error {
  constructor(public readonly code: CommunityServiceErrorCode) {
    super(code)
    this.name = 'CommunityServiceError'
  }
}

function fail(code: CommunityServiceErrorCode): never {
  throw new CommunityServiceError(code)
}

export type GroupInput = {
  name: string
  description: string
  rules: string
  visibility: GroupVisibility
  icon: string | null
  /** Round 9C join setting; when omitted the repository keeps the stored value (or derives it from visibility on create). */
  joinPolicy?: GroupJoinPolicy
}

export function joinRequestDedupeKey(groupId: string, requesterId: string, recipientId: string) {
  return `group-join-request:${groupId}:${requesterId}:${recipientId}`
}

export function joinApprovedDedupeKey(groupId: string, memberId: string) {
  return `group-join-approved:${groupId}:${memberId}`
}

export function createCommunityService(input: {
  repository?: CommunityRepository
  /** Whether a profile is a Sea N Shore platform administrator (they moderate every community). */
  canAccessPlatformAdmin?: (userId: string) => Promise<boolean>
} = {}) {
  const repository = input.repository ?? communityRepository
  const canAccessPlatformAdmin = input.canAccessPlatformAdmin ?? canAccessPlatformAdminDefault

  async function isPlatformAdmin(userId: string) {
    return canAccessPlatformAdmin(userId).catch(() => false)
  }

  async function requireLiveGroup(viewerId: string, groupId: string): Promise<CommunityGroup> {
    const group = await repository.getById(viewerId, groupId)
    if (!group) fail('group_not_found')
    if (group.archived) fail('group_archived')
    return group
  }

  /** True for the group's active moderators ('admin') and its owner. */
  function administers(group: Pick<CommunityGroup, 'viewerMembership'>) {
    const membership = group.viewerMembership
    return Boolean(membership && membership.status === 'active' && isGroupAdminRole(membership.role))
  }

  /**
   * The group when the actor is one of its active moderators, its owner or a Sea N Shore
   * administrator; otherwise a forbidden error.
   */
  async function requireAdministeredGroup(actorId: string, groupId: string) {
    const group = await requireLiveGroup(actorId, groupId)
    if (!administers(group) && !(await isPlatformAdmin(actorId))) fail('group_forbidden')
    return group
  }

  /**
   * Open groups: the member joins at once. Approval-required groups: a request is stored and
   * every active moderator/owner is notified. Members removed by a moderator cannot rejoin by
   * themselves. Sea N Shore administrators always join at once (an audit event records it).
   */
  async function joinGroup(viewerId: string, groupId: string): Promise<{ status: MembershipStatus; group: CommunityGroup }> {
    const group = await requireLiveGroup(viewerId, groupId)
    const current = group.viewerMembership
    if (current?.status === 'active' || current?.status === 'pending') return { status: current.status, group }
    if (await isPlatformAdmin(viewerId)) {
      await repository.activateMembership(groupId, viewerId)
      await repository.insertAuditEvent(viewerId, 'community.admin_joined', groupId, { join_policy: group.joinPolicy })
      return { status: 'active', group }
    }
    if (current?.status === 'removed') fail('group_join_blocked')
    const status: MembershipStatus = group.joinPolicy === 'open' ? 'active' : 'pending'
    await repository.upsertJoin(groupId, viewerId, status)
    if (status === 'pending') {
      for (const recipientId of await repository.listAdminIds(groupId)) {
        if (recipientId === viewerId) continue
        await repository.upsertNotification({
          recipientId,
          actorId: viewerId,
          type: 'group_join_request',
          groupId,
          dedupeKey: joinRequestDedupeKey(groupId, viewerId, recipientId),
        })
      }
    }
    return { status, group }
  }

  /** Leaves the group or withdraws a pending request. Owners hand over the group first. */
  async function leaveGroup(viewerId: string, groupId: string) {
    const group = await repository.getById(viewerId, groupId)
    if (!group) fail('group_not_found')
    const current = group.viewerMembership
    if (!current || current.status === 'removed') return
    if (current.role === 'owner') fail('group_owner_protected')
    await repository.deleteMembership(groupId, viewerId)
    if (current.status === 'pending') await clearJoinRequestNotifications(groupId, viewerId)
  }

  async function clearJoinRequestNotifications(groupId: string, requesterId: string) {
    for (const adminId of await repository.listAdminIds(groupId)) {
      await repository.deleteNotification(adminId, joinRequestDedupeKey(groupId, requesterId, adminId))
    }
  }

  async function approveJoinRequest(actorId: string, groupId: string, profileId: string) {
    await requireAdministeredGroup(actorId, groupId)
    const approved = await repository.approveRequest(groupId, profileId)
    if (!approved) fail('group_member_not_found')
    await clearJoinRequestNotifications(groupId, profileId)
    await repository.upsertNotification({
      recipientId: profileId,
      actorId,
      type: 'group_join_approved',
      groupId,
      dedupeKey: joinApprovedDedupeKey(groupId, profileId),
    })
  }

  async function declineJoinRequest(actorId: string, groupId: string, profileId: string) {
    await requireAdministeredGroup(actorId, groupId)
    const declined = await repository.declineRequest(groupId, profileId)
    if (!declined) fail('group_member_not_found')
    await clearJoinRequestNotifications(groupId, profileId)
  }

  /**
   * Approves every waiting request at once (for example after switching the join setting to
   * Open, which never approves anything by itself). Each approved member is notified.
   */
  async function approveAllPending(actorId: string, groupId: string) {
    await requireAdministeredGroup(actorId, groupId)
    const approvedIds = await repository.approveAllRequests(groupId)
    for (const profileId of approvedIds) {
      await clearJoinRequestNotifications(groupId, profileId)
      await repository.upsertNotification({
        recipientId: profileId,
        actorId,
        type: 'group_join_approved',
        groupId,
        dedupeKey: joinApprovedDedupeKey(groupId, profileId),
      })
    }
    if (approvedIds.length) {
      await repository.insertAuditEvent(actorId, 'community.requests_approved_all', groupId, { count: approvedIds.length, profile_ids: approvedIds })
    }
    return approvedIds
  }

  /** Moderators and the owner remove members and other moderators; nobody removes the owner or themselves here. */
  async function removeMember(actorId: string, groupId: string, profileId: string) {
    if (actorId === profileId) fail('group_self_action')
    await requireAdministeredGroup(actorId, groupId)
    const target = await repository.getMembership(groupId, profileId)
    if (!target || target.status !== 'active') fail('group_member_not_found')
    if (target.role === 'owner') fail('group_owner_protected')
    await repository.removeMember(groupId, profileId)
    await repository.insertAuditEvent(actorId, 'community.member_removed', groupId, { profile_id: profileId, role: target.role })
  }

  /**
   * The owner, moderators and Sea N Shore administrators make members moderators and demote
   * other moderators. The owner's role never changes here (see `transferOwnership`) and
   * nobody changes their own role.
   */
  async function setMemberRole(actorId: string, groupId: string, profileId: string, role: 'member' | 'admin') {
    if (actorId === profileId) fail('group_self_action')
    await requireAdministeredGroup(actorId, groupId)
    const target = await repository.getMembership(groupId, profileId)
    if (!target || target.status !== 'active') fail('group_member_not_found')
    if (target.role === 'owner') fail('group_owner_protected')
    if (target.role === role) return
    await repository.setMemberRole(groupId, profileId, role)
    await repository.insertAuditEvent(actorId, 'community.role_changed', groupId, { profile_id: profileId, from: target.role, to: role })
  }

  /**
   * Only the owner hands the community to another active member; the previous owner stays as
   * a moderator. Site administrators use the Communities admin page instead.
   */
  async function transferOwnership(actorId: string, groupId: string, newOwnerId: string) {
    if (actorId === newOwnerId) fail('group_self_action')
    const group = await requireLiveGroup(actorId, groupId)
    const actor = group.viewerMembership
    if (!actor || actor.status !== 'active' || actor.role !== 'owner') fail('group_owner_only')
    const target = await repository.getMembership(groupId, newOwnerId)
    if (!target || target.status !== 'active') fail('group_member_not_found')
    await repository.setOwner(groupId, newOwnerId)
    await repository.insertAuditEvent(actorId, 'community.ownership_transferred', groupId, { owner_id: newOwnerId, previous_owner_id: actorId, previous_role: target.role })
  }

  /** Moderators edit the description, rules, icon, visibility and join setting; the name and slug stay. */
  async function updateGroup(actorId: string, groupId: string, changes: Omit<GroupInput, 'name'>) {
    const group = await requireAdministeredGroup(actorId, groupId)
    await repository.updateGroup(groupId, { ...changes, name: group.name })
    if (changes.joinPolicy && changes.joinPolicy !== group.joinPolicy) {
      await repository.insertAuditEvent(actorId, 'community.join_policy_changed', groupId, { from: group.joinPolicy, to: changes.joinPolicy })
    }
  }

  /**
   * A moderator, the owner or a Sea N Shore administrator removes a post from a group: the
   * same soft delete as an organization admin's, so the author can see it under Recently
   * deleted for 30 days.
   */
  async function removeGroupPost(actorId: string, postId: string) {
    const post = await repository.getPostGroup(postId)
    if (!post || !post.groupId) fail('group_post_not_found')
    const membership = await repository.getMembership(post.groupId, actorId)
    const moderates = Boolean(membership && membership.status === 'active' && isGroupAdminRole(membership.role))
    if (!moderates && !(await isPlatformAdmin(actorId))) fail('group_forbidden')
    const removed = await repository.softDeleteGroupPost(actorId, postId, post.groupId)
    if (!removed) fail('group_post_not_found')
  }

  /** Groups to suggest on the directory: the heuristic slugs minus the viewer's own groups. */
  async function suggestGroups(viewerId: string) {
    const [signals, own] = await Promise.all([
      repository.getSuggestionSignals(viewerId).catch((): { rank: null; vesselTypes: []; persona: null } => ({ rank: null, vesselTypes: [], persona: null })),
      repository.listViewerGroups(viewerId),
    ])
    const slugs = suggestedGroupSlugs(signals, own.map((group) => group.slug))
    return repository.listBySlugs(viewerId, slugs)
  }

  /**
   * Creates a group with a unique slug and its owner as the first active member. Site
   * administrators create for any owner; members create for themselves (`create-actions.ts`
   * checks the Creator Pro / Organization Pro rules first) with `ownerCompanyId` set when an
   * organization owns the community.
   */
  async function createGroup(actorId: string, group: GroupInput & { ownerId: string; ownerCompanyId?: string | null }) {
    const base = groupSlugFromName(group.name)
    const slug = uniqueGroupSlug(base, await repository.listSlugsLike(base))
    const joinPolicy = group.joinPolicy ?? (group.visibility === 'private' ? 'approval' : 'open')
    const groupId = await repository.createGroup({
      name: group.name,
      slug,
      description: group.description,
      rules: group.rules,
      visibility: group.visibility,
      icon: group.icon,
      joinPolicy,
      createdBy: actorId,
      ownerId: group.ownerId,
      ownerCompanyId: group.ownerCompanyId ?? null,
    })
    await repository.insertAuditEvent(actorId, 'community.group_created', groupId, {
      slug,
      owner_id: group.ownerId,
      owner_company_id: group.ownerCompanyId ?? null,
      visibility: group.visibility,
      join_policy: joinPolicy,
    })
    return { id: groupId, slug }
  }

  // Site administration (the caller has already required a platform administrator).

  async function updateGroupAsAdmin(adminId: string, groupId: string, group: GroupInput) {
    const before = await repository.getById(adminId, groupId)
    if (!before) fail('group_not_found')
    const updated = await repository.updateGroup(groupId, group)
    if (!updated) fail('group_not_found')
    await repository.insertAuditEvent(adminId, 'community.group_updated', groupId, { visibility: group.visibility, join_policy: group.joinPolicy ?? before.joinPolicy })
    if (group.joinPolicy && group.joinPolicy !== before.joinPolicy) {
      await repository.insertAuditEvent(adminId, 'community.join_policy_changed', groupId, { from: before.joinPolicy, to: group.joinPolicy })
    }
  }

  async function archiveGroup(adminId: string, groupId: string) {
    const changed = await repository.setArchived(groupId, true)
    if (!changed) fail('group_not_found')
    await repository.insertAuditEvent(adminId, 'community.group_archived', groupId)
  }

  async function unarchiveGroup(adminId: string, groupId: string) {
    const changed = await repository.setArchived(groupId, false)
    if (!changed) fail('group_not_found')
    await repository.insertAuditEvent(adminId, 'community.group_unarchived', groupId)
  }

  /** An active member by sign-in email or profile handle (site-admin owner picker). */
  async function findOwner(lookup: string) {
    const owner = await repository.findProfileByEmailOrSlug(lookup)
    if (!owner) fail('group_owner_not_found')
    return owner
  }

  /** Owner by sign-in email or profile handle; the previous owner stays as an admin. */
  async function setGroupOwner(adminId: string, groupId: string, ownerLookup: string) {
    const owner = await findOwner(ownerLookup)
    const group = await repository.getById(adminId, groupId)
    if (!group) fail('group_not_found')
    await repository.setOwner(groupId, owner.id)
    await repository.insertAuditEvent(adminId, 'community.group_owner_changed', groupId, { owner_id: owner.id })
    return owner
  }

  return {
    joinGroup,
    leaveGroup,
    approveJoinRequest,
    declineJoinRequest,
    approveAllPending,
    removeMember,
    setMemberRole,
    transferOwnership,
    updateGroup,
    removeGroupPost,
    suggestGroups,
    createGroup,
    updateGroupAsAdmin,
    archiveGroup,
    unarchiveGroup,
    findOwner,
    setGroupOwner,
  }
}

export type CommunityService = ReturnType<typeof createCommunityService>

export const communityService = createCommunityService()
