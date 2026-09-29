import { communityRepository, type CommunityRepository } from './repository'
import { groupSlugFromName, uniqueGroupSlug } from './slug'
import { suggestedGroupSlugs } from './suggestions'
import {
  isGroupAdminRole,
  type CommunityGroup,
  type GroupVisibility,
  type MembershipStatus,
} from './types'

export type CommunityServiceErrorCode =
  | 'group_not_found'
  | 'group_archived'
  | 'group_join_blocked'
  | 'group_forbidden'
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
}

export function joinRequestDedupeKey(groupId: string, requesterId: string, recipientId: string) {
  return `group-join-request:${groupId}:${requesterId}:${recipientId}`
}

export function joinApprovedDedupeKey(groupId: string, memberId: string) {
  return `group-join-approved:${groupId}:${memberId}`
}

export function createCommunityService(input: { repository?: CommunityRepository } = {}) {
  const repository = input.repository ?? communityRepository

  async function requireLiveGroup(viewerId: string, groupId: string): Promise<CommunityGroup> {
    const group = await repository.getById(viewerId, groupId)
    if (!group) fail('group_not_found')
    if (group.archived) fail('group_archived')
    return group
  }

  /** The group when the actor is one of its active admins or its owner; otherwise a forbidden error. */
  async function requireAdministeredGroup(actorId: string, groupId: string) {
    const group = await requireLiveGroup(actorId, groupId)
    const membership = group.viewerMembership
    if (!membership || membership.status !== 'active' || !isGroupAdminRole(membership.role)) fail('group_forbidden')
    return group
  }

  /**
   * Public groups: the member joins at once. Private groups: a request is stored and every
   * active admin/owner is notified. Members removed by an admin cannot rejoin by themselves.
   */
  async function joinGroup(viewerId: string, groupId: string): Promise<{ status: MembershipStatus; group: CommunityGroup }> {
    const group = await requireLiveGroup(viewerId, groupId)
    const current = group.viewerMembership
    if (current?.status === 'active' || current?.status === 'pending') return { status: current.status, group }
    if (current?.status === 'removed') fail('group_join_blocked')
    const status: MembershipStatus = group.visibility === 'public' ? 'active' : 'pending'
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

  /** Admins and the owner remove members and other admins; nobody removes the owner or themselves here. */
  async function removeMember(actorId: string, groupId: string, profileId: string) {
    if (actorId === profileId) fail('group_self_action')
    await requireAdministeredGroup(actorId, groupId)
    const target = await repository.getMembership(groupId, profileId)
    if (!target || target.status !== 'active') fail('group_member_not_found')
    if (target.role === 'owner') fail('group_owner_protected')
    await repository.removeMember(groupId, profileId)
  }

  async function setMemberRole(actorId: string, groupId: string, profileId: string, role: 'member' | 'admin') {
    if (actorId === profileId) fail('group_self_action')
    await requireAdministeredGroup(actorId, groupId)
    const target = await repository.getMembership(groupId, profileId)
    if (!target || target.status !== 'active') fail('group_member_not_found')
    if (target.role === 'owner') fail('group_owner_protected')
    await repository.setMemberRole(groupId, profileId, role)
  }

  /** Group admins edit the description, rules, icon and visibility; the name and slug stay. */
  async function updateGroup(actorId: string, groupId: string, changes: Omit<GroupInput, 'name'>) {
    const group = await requireAdministeredGroup(actorId, groupId)
    await repository.updateGroup(groupId, { ...changes, name: group.name })
  }

  /**
   * A group admin or the owner removes a post from their group: the same soft delete as an
   * organization admin's, so the author can see it under Recently deleted for 30 days.
   */
  async function removeGroupPost(actorId: string, postId: string) {
    const post = await repository.getPostGroup(postId)
    if (!post || !post.groupId) fail('group_post_not_found')
    const membership = await repository.getMembership(post.groupId, actorId)
    if (!membership || membership.status !== 'active' || !isGroupAdminRole(membership.role)) fail('group_forbidden')
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

  // Site administration (the caller has already required a platform administrator).

  async function createGroup(adminId: string, group: GroupInput & { ownerId: string }) {
    const base = groupSlugFromName(group.name)
    const slug = uniqueGroupSlug(base, await repository.listSlugsLike(base))
    const groupId = await repository.createGroup({
      name: group.name,
      slug,
      description: group.description,
      rules: group.rules,
      visibility: group.visibility,
      icon: group.icon,
      createdBy: adminId,
      ownerId: group.ownerId,
    })
    await repository.insertAuditEvent(adminId, 'community.group_created', groupId, { slug, owner_id: group.ownerId, visibility: group.visibility })
    return { id: groupId, slug }
  }

  async function updateGroupAsAdmin(adminId: string, groupId: string, group: GroupInput) {
    const updated = await repository.updateGroup(groupId, group)
    if (!updated) fail('group_not_found')
    await repository.insertAuditEvent(adminId, 'community.group_updated', groupId, { visibility: group.visibility })
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
    removeMember,
    setMemberRole,
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
