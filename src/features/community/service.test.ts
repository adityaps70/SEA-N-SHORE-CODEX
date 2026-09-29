import { describe, expect, it, vi } from 'vitest'
import type { CommunityRepository } from './repository'
import { CommunityServiceError, createCommunityService } from './service'
import type { CommunityGroup, ViewerMembership } from './types'

// The default platform-admin check reads the database; the service takes an injected one instead.
vi.mock('@/features/admin/access', () => ({ canAccessPlatformAdmin: vi.fn(async () => false) }))

const viewerId = '11111111-1111-4111-8111-111111111111'
const adminId = '22222222-2222-4222-8222-222222222222'
const ownerId = '55555555-5555-4555-8555-555555555555'
const groupId = '33333333-3333-4333-8333-333333333333'
const postId = '44444444-4444-4444-8444-444444444444'
const siteAdminId = '66666666-6666-4666-8666-666666666666'

/** Round 9C: the join setting decides how members get in; this private fixture needs approval (the round 9B default). */
function group(overrides: Partial<CommunityGroup> = {}): CommunityGroup {
  return {
    id: groupId, slug: 'tanker-professionals', name: 'Tanker Professionals', description: '', rules: '', coverUrl: null, iconUrl: null, icon: 'ShieldCheck', joinPolicy: 'approval', ownerOrganization: null,
    visibility: 'private', memberCount: 4, archived: false, createdBy: ownerId, viewerMembership: null, ...overrides,
  }
}

function repository(overrides: Partial<CommunityRepository> = {}) {
  return {
    getById: vi.fn(async () => group()),
    getMembership: vi.fn(async () => null),
    upsertJoin: vi.fn(async () => true),
    activateMembership: vi.fn(async () => undefined),
    deleteMembership: vi.fn(async () => true),
    approveRequest: vi.fn(async () => true),
    approveAllRequests: vi.fn(async () => [viewerId, adminId]),
    declineRequest: vi.fn(async () => true),
    removeMember: vi.fn(async () => true),
    setMemberRole: vi.fn(async () => true),
    listAdminIds: vi.fn(async () => [adminId, ownerId]),
    upsertNotification: vi.fn(async () => undefined),
    deleteNotification: vi.fn(async () => undefined),
    getPostGroup: vi.fn(async () => ({ postId, groupId, authorId: viewerId })),
    softDeleteGroupPost: vi.fn(async () => true),
    updateGroup: vi.fn(async () => true),
    setArchived: vi.fn(async () => true),
    insertAuditEvent: vi.fn(async () => undefined),
    listSlugsLike: vi.fn(async () => ['tanker-professionals']),
    createGroup: vi.fn(async () => groupId),
    findProfileByEmailOrSlug: vi.fn(async () => ({ id: ownerId, fullName: 'Asha Singh', slug: 'asha' })),
    setOwner: vi.fn(async () => undefined),
    getSuggestionSignals: vi.fn(async () => ({ rank: 'Chief Engineer', vesselTypes: [], persona: null })),
    listViewerGroups: vi.fn(async () => [group({ slug: 'ask-the-community' })]),
    listBySlugs: vi.fn(async (_viewer: string, slugs: string[]) => slugs.map((slug) => group({ slug }))),
    ...overrides,
  } as unknown as CommunityRepository
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error instanceof CommunityServiceError ? error.code : String(error)
  }
  return null
}

describe('community service: joining and leaving', () => {
  it('joins an open group at once without notifying anyone', async () => {
    const repo = repository({ getById: vi.fn(async () => group({ visibility: 'public', joinPolicy: 'open' })) })
    const result = await createCommunityService({ repository: repo }).joinGroup(viewerId, groupId)
    expect(result.status).toBe('active')
    expect(repo.upsertJoin).toHaveBeenCalledWith(groupId, viewerId, 'active')
    expect(repo.upsertNotification).not.toHaveBeenCalled()
  })

  it('lets the join setting decide, not the visibility (round 9C): private + open joins at once, public + approval waits', async () => {
    const privateOpen = repository({ getById: vi.fn(async () => group({ visibility: 'private', joinPolicy: 'open' })) })
    await expect(createCommunityService({ repository: privateOpen }).joinGroup(viewerId, groupId)).resolves.toMatchObject({ status: 'active' })
    expect(privateOpen.upsertJoin).toHaveBeenCalledWith(groupId, viewerId, 'active')
    expect(privateOpen.upsertNotification).not.toHaveBeenCalled()

    const publicApproval = repository({ getById: vi.fn(async () => group({ visibility: 'public', joinPolicy: 'approval' })) })
    await expect(createCommunityService({ repository: publicApproval }).joinGroup(viewerId, groupId)).resolves.toMatchObject({ status: 'pending' })
    expect(publicApproval.upsertJoin).toHaveBeenCalledWith(groupId, viewerId, 'pending')
    expect(publicApproval.upsertNotification).toHaveBeenCalledTimes(2)
  })

  it('lets Sea N Shore administrators into approval-required groups at once, even after being removed, with an audit event', async () => {
    const repo = repository({ getById: vi.fn(async () => group({ viewerMembership: { role: 'member', status: 'removed' } })) })
    const service = createCommunityService({ repository: repo, canAccessPlatformAdmin: async (userId) => userId === siteAdminId })
    await expect(service.joinGroup(siteAdminId, groupId)).resolves.toMatchObject({ status: 'active' })
    expect(repo.activateMembership).toHaveBeenCalledWith(groupId, siteAdminId)
    expect(repo.upsertJoin).not.toHaveBeenCalled()
    expect(repo.upsertNotification).not.toHaveBeenCalled()
    expect(repo.insertAuditEvent).toHaveBeenCalledWith(siteAdminId, 'community.admin_joined', groupId, { join_policy: 'approval' })
    // Ordinary members are still blocked after removal.
    expect(await codeOf(service.joinGroup(viewerId, groupId))).toBe('group_join_blocked')
  })

  it('asks to join an approval-required group and notifies every moderator and the owner with a dedupe key', async () => {
    const repo = repository()
    const result = await createCommunityService({ repository: repo }).joinGroup(viewerId, groupId)
    expect(result.status).toBe('pending')
    expect(repo.upsertJoin).toHaveBeenCalledWith(groupId, viewerId, 'pending')
    expect(repo.upsertNotification).toHaveBeenCalledTimes(2)
    expect(repo.upsertNotification).toHaveBeenCalledWith({
      recipientId: adminId, actorId: viewerId, type: 'group_join_request', groupId, dedupeKey: `group-join-request:${groupId}:${viewerId}:${adminId}`,
    })
  })

  it('does not notify the requester when they administer the group, and repeats nothing for existing rows', async () => {
    const pending = repository({ getById: vi.fn(async () => group({ viewerMembership: { role: 'member', status: 'pending' } })) })
    await expect(createCommunityService({ repository: pending }).joinGroup(viewerId, groupId)).resolves.toMatchObject({ status: 'pending' })
    expect(pending.upsertJoin).not.toHaveBeenCalled()
    const selfAdmin = repository({ listAdminIds: vi.fn(async () => [viewerId]) })
    await createCommunityService({ repository: selfAdmin }).joinGroup(viewerId, groupId)
    expect(selfAdmin.upsertNotification).not.toHaveBeenCalled()
  })

  it('blocks members an admin removed, and archived groups', async () => {
    const removed = repository({ getById: vi.fn(async () => group({ viewerMembership: { role: 'member', status: 'removed' } })) })
    expect(await codeOf(createCommunityService({ repository: removed }).joinGroup(viewerId, groupId))).toBe('group_join_blocked')
    const archived = repository({ getById: vi.fn(async () => group({ archived: true })) })
    expect(await codeOf(createCommunityService({ repository: archived }).joinGroup(viewerId, groupId))).toBe('group_archived')
    expect(await codeOf(createCommunityService({ repository: repository({ getById: vi.fn(async () => null) }) }).joinGroup(viewerId, groupId))).toBe('group_not_found')
  })

  it('lets members leave, clears a withdrawn request from admin inboxes and protects the owner', async () => {
    const pending = repository({ getById: vi.fn(async () => group({ viewerMembership: { role: 'member', status: 'pending' } })) })
    await createCommunityService({ repository: pending }).leaveGroup(viewerId, groupId)
    expect(pending.deleteMembership).toHaveBeenCalledWith(groupId, viewerId)
    expect(pending.deleteNotification).toHaveBeenCalledWith(adminId, `group-join-request:${groupId}:${viewerId}:${adminId}`)
    const owner = repository({ getById: vi.fn(async () => group({ viewerMembership: { role: 'owner', status: 'active' } })) })
    expect(await codeOf(createCommunityService({ repository: owner }).leaveGroup(viewerId, groupId))).toBe('group_owner_protected')
  })
})

describe('community service: group administration', () => {
  const asAdmin = (overrides: Partial<CommunityRepository> = {}) => repository({
    getById: vi.fn(async () => group({ viewerMembership: { role: 'admin', status: 'active' } })),
    ...overrides,
  })

  it('refuses admin actions from plain members', async () => {
    const member = repository({ getById: vi.fn(async () => group({ viewerMembership: { role: 'member', status: 'active' } })) })
    const service = createCommunityService({ repository: member })
    expect(await codeOf(service.approveJoinRequest(viewerId, groupId, adminId))).toBe('group_forbidden')
    expect(await codeOf(service.removeMember(viewerId, groupId, adminId))).toBe('group_forbidden')
    expect(await codeOf(service.setMemberRole(viewerId, groupId, adminId, 'admin'))).toBe('group_forbidden')
    expect(await codeOf(service.updateGroup(viewerId, groupId, { description: '', rules: '', visibility: 'public', icon: null }))).toBe('group_forbidden')
    expect(member.approveRequest).not.toHaveBeenCalled()
  })

  it('approves a request, clears the request notifications and tells the member', async () => {
    const repo = asAdmin()
    await createCommunityService({ repository: repo }).approveJoinRequest(adminId, groupId, viewerId)
    expect(repo.approveRequest).toHaveBeenCalledWith(groupId, viewerId)
    expect(repo.deleteNotification).toHaveBeenCalledWith(ownerId, `group-join-request:${groupId}:${viewerId}:${ownerId}`)
    expect(repo.upsertNotification).toHaveBeenCalledWith({
      recipientId: viewerId, actorId: adminId, type: 'group_join_approved', groupId, dedupeKey: `group-join-approved:${groupId}:${viewerId}`,
    })
  })

  it('declines a request and fails clearly when it is gone', async () => {
    const repo = asAdmin({ declineRequest: vi.fn(async () => false) })
    expect(await codeOf(createCommunityService({ repository: repo }).declineJoinRequest(adminId, groupId, viewerId))).toBe('group_member_not_found')
  })

  it('never removes or demotes the owner, and never the actor themselves', async () => {
    const repo = asAdmin({ getMembership: vi.fn(async (): Promise<ViewerMembership | null> => ({ role: 'owner', status: 'active' })) })
    const service = createCommunityService({ repository: repo })
    expect(await codeOf(service.removeMember(adminId, groupId, ownerId))).toBe('group_owner_protected')
    expect(await codeOf(service.setMemberRole(adminId, groupId, ownerId, 'member'))).toBe('group_owner_protected')
    expect(await codeOf(service.removeMember(adminId, groupId, adminId))).toBe('group_self_action')
    expect(repo.removeMember).not.toHaveBeenCalled()
  })

  it('removes members and changes roles for active members, writing audit events', async () => {
    const repo = asAdmin({ getMembership: vi.fn(async (): Promise<ViewerMembership | null> => ({ role: 'member', status: 'active' })) })
    const service = createCommunityService({ repository: repo })
    await service.removeMember(adminId, groupId, viewerId)
    await service.setMemberRole(adminId, groupId, viewerId, 'admin')
    expect(repo.removeMember).toHaveBeenCalledWith(groupId, viewerId)
    expect(repo.setMemberRole).toHaveBeenCalledWith(groupId, viewerId, 'admin')
    expect(repo.insertAuditEvent).toHaveBeenCalledWith(adminId, 'community.member_removed', groupId, { profile_id: viewerId, role: 'member' })
    expect(repo.insertAuditEvent).toHaveBeenCalledWith(adminId, 'community.role_changed', groupId, { profile_id: viewerId, from: 'member', to: 'admin' })
  })

  it('lets a moderator demote another moderator, and skips a no-op role change', async () => {
    const repo = asAdmin({ getMembership: vi.fn(async (): Promise<ViewerMembership | null> => ({ role: 'admin', status: 'active' })) })
    const service = createCommunityService({ repository: repo })
    await service.setMemberRole(adminId, groupId, viewerId, 'member')
    expect(repo.setMemberRole).toHaveBeenCalledWith(groupId, viewerId, 'member')
    expect(repo.insertAuditEvent).toHaveBeenCalledWith(adminId, 'community.role_changed', groupId, { profile_id: viewerId, from: 'admin', to: 'member' })
    await service.setMemberRole(adminId, groupId, viewerId, 'admin')
    expect(repo.setMemberRole).toHaveBeenCalledTimes(1)
  })

  it('lets the owner promote and demote too, but never their own role', async () => {
    const repo = repository({
      getById: vi.fn(async () => group({ viewerMembership: { role: 'owner', status: 'active' } })),
      getMembership: vi.fn(async (): Promise<ViewerMembership | null> => ({ role: 'admin', status: 'active' })),
    })
    const service = createCommunityService({ repository: repo })
    await service.setMemberRole(ownerId, groupId, adminId, 'member')
    expect(repo.setMemberRole).toHaveBeenCalledWith(groupId, adminId, 'member')
    expect(await codeOf(service.setMemberRole(ownerId, groupId, ownerId, 'admin'))).toBe('group_self_action')
  })

  it('lets Sea N Shore administrators moderate without a membership: approvals, roles, settings and posts', async () => {
    const repo = repository({
      getById: vi.fn(async () => group()),
      getMembership: vi.fn(async (): Promise<ViewerMembership | null> => ({ role: 'member', status: 'active' })),
    })
    const service = createCommunityService({ repository: repo, canAccessPlatformAdmin: async (userId) => userId === siteAdminId })
    await service.approveJoinRequest(siteAdminId, groupId, viewerId)
    await service.setMemberRole(siteAdminId, groupId, viewerId, 'admin')
    await service.updateGroup(siteAdminId, groupId, { description: 'd', rules: 'r', visibility: 'private', joinPolicy: 'approval', icon: null })
    await service.removeGroupPost(siteAdminId, postId)
    expect(repo.approveRequest).toHaveBeenCalledWith(groupId, viewerId)
    expect(repo.setMemberRole).toHaveBeenCalledWith(groupId, viewerId, 'admin')
    expect(repo.updateGroup).toHaveBeenCalled()
    expect(repo.softDeleteGroupPost).toHaveBeenCalledWith(siteAdminId, postId, groupId)
    // A plain member with the same (non-admin) check is still refused.
    expect(await codeOf(service.approveJoinRequest(viewerId, groupId, adminId))).toBe('group_forbidden')
  })

  it('transfers ownership only from the owner to another active member, with an audit event', async () => {
    const asOwner = repository({
      getById: vi.fn(async () => group({ viewerMembership: { role: 'owner', status: 'active' } })),
      getMembership: vi.fn(async (): Promise<ViewerMembership | null> => ({ role: 'admin', status: 'active' })),
    })
    await createCommunityService({ repository: asOwner }).transferOwnership(ownerId, groupId, adminId)
    expect(asOwner.setOwner).toHaveBeenCalledWith(groupId, adminId)
    expect(asOwner.insertAuditEvent).toHaveBeenCalledWith(ownerId, 'community.ownership_transferred', groupId, { owner_id: adminId, previous_owner_id: ownerId, previous_role: 'admin' })

    const moderator = asAdmin({ getMembership: vi.fn(async (): Promise<ViewerMembership | null> => ({ role: 'member', status: 'active' })) })
    expect(await codeOf(createCommunityService({ repository: moderator }).transferOwnership(adminId, groupId, viewerId))).toBe('group_owner_only')
    expect(moderator.setOwner).not.toHaveBeenCalled()
    // Even a site administrator uses the admin page for this.
    const siteAdmin = createCommunityService({ repository: moderator, canAccessPlatformAdmin: async () => true })
    expect(await codeOf(siteAdmin.transferOwnership(siteAdminId, groupId, viewerId))).toBe('group_owner_only')

    const pendingTarget = repository({
      getById: vi.fn(async () => group({ viewerMembership: { role: 'owner', status: 'active' } })),
      getMembership: vi.fn(async (): Promise<ViewerMembership | null> => ({ role: 'member', status: 'pending' })),
    })
    expect(await codeOf(createCommunityService({ repository: pendingTarget }).transferOwnership(ownerId, groupId, viewerId))).toBe('group_member_not_found')
    expect(await codeOf(createCommunityService({ repository: pendingTarget }).transferOwnership(ownerId, groupId, ownerId))).toBe('group_self_action')
  })

  it('approves all pending requests, notifies each member and writes one audit event', async () => {
    const repo = asAdmin()
    const approved = await createCommunityService({ repository: repo }).approveAllPending(adminId, groupId)
    expect(approved).toEqual([viewerId, adminId])
    expect(repo.approveAllRequests).toHaveBeenCalledWith(groupId)
    expect(repo.upsertNotification).toHaveBeenCalledWith({
      recipientId: viewerId, actorId: adminId, type: 'group_join_approved', groupId, dedupeKey: `group-join-approved:${groupId}:${viewerId}`,
    })
    expect(repo.deleteNotification).toHaveBeenCalledWith(ownerId, `group-join-request:${groupId}:${viewerId}:${ownerId}`)
    expect(repo.insertAuditEvent).toHaveBeenCalledWith(adminId, 'community.requests_approved_all', groupId, { count: 2, profile_ids: [viewerId, adminId] })

    const nothing = asAdmin({ approveAllRequests: vi.fn(async () => []) })
    await expect(createCommunityService({ repository: nothing }).approveAllPending(adminId, groupId)).resolves.toEqual([])
    expect(nothing.insertAuditEvent).not.toHaveBeenCalled()
    const member = repository({ getById: vi.fn(async () => group({ viewerMembership: { role: 'member', status: 'active' } })) })
    expect(await codeOf(createCommunityService({ repository: member }).approveAllPending(viewerId, groupId))).toBe('group_forbidden')
  })

  it('keeps the name when a moderator edits the description, rules, visibility and icon', async () => {
    const repo = asAdmin()
    await createCommunityService({ repository: repo }).updateGroup(adminId, groupId, { description: 'New', rules: 'Rules', visibility: 'public', icon: 'Wrench' })
    expect(repo.updateGroup).toHaveBeenCalledWith(groupId, { name: 'Tanker Professionals', description: 'New', rules: 'Rules', visibility: 'public', icon: 'Wrench' })
    expect(repo.insertAuditEvent).not.toHaveBeenCalled()
  })

  it('saves the join setting and audits a change of it (moderators and site admins alike)', async () => {
    const repo = asAdmin()
    await createCommunityService({ repository: repo }).updateGroup(adminId, groupId, { description: '', rules: '', visibility: 'private', joinPolicy: 'open', icon: null })
    expect(repo.updateGroup).toHaveBeenCalledWith(groupId, expect.objectContaining({ joinPolicy: 'open' }))
    expect(repo.insertAuditEvent).toHaveBeenCalledWith(adminId, 'community.join_policy_changed', groupId, { from: 'approval', to: 'open' })

    const unchanged = asAdmin()
    await createCommunityService({ repository: unchanged }).updateGroup(adminId, groupId, { description: '', rules: '', visibility: 'private', joinPolicy: 'approval', icon: null })
    expect(unchanged.insertAuditEvent).not.toHaveBeenCalled()

    const viaAdminPage = repository()
    await createCommunityService({ repository: viaAdminPage }).updateGroupAsAdmin(siteAdminId, groupId, { name: 'Tanker Professionals', description: '', rules: '', visibility: 'private', joinPolicy: 'open', icon: null })
    expect((viaAdminPage.insertAuditEvent as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[1])).toEqual(['community.group_updated', 'community.join_policy_changed'])
  })
})

describe('community service: removing a post from a group', () => {
  it('refuses members who do not administer the post’s group', async () => {
    const member = repository({ getMembership: vi.fn(async (): Promise<ViewerMembership | null> => ({ role: 'member', status: 'active' })) })
    expect(await codeOf(createCommunityService({ repository: member }).removeGroupPost(viewerId, postId))).toBe('group_forbidden')
    const nobody = repository()
    expect(await codeOf(createCommunityService({ repository: nobody }).removeGroupPost(viewerId, postId))).toBe('group_forbidden')
    expect(member.softDeleteGroupPost).not.toHaveBeenCalled()
  })

  it('refuses posts outside a group', async () => {
    const open = repository({ getPostGroup: vi.fn(async () => ({ postId, groupId: null, authorId: viewerId })) })
    expect(await codeOf(createCommunityService({ repository: open }).removeGroupPost(adminId, postId))).toBe('group_post_not_found')
  })

  it('soft-deletes the post for group admins and owners', async () => {
    const repo = repository({ getMembership: vi.fn(async (): Promise<ViewerMembership | null> => ({ role: 'owner', status: 'active' })) })
    await createCommunityService({ repository: repo }).removeGroupPost(ownerId, postId)
    expect(repo.getMembership).toHaveBeenCalledWith(groupId, ownerId)
    expect(repo.softDeleteGroupPost).toHaveBeenCalledWith(ownerId, postId, groupId)
  })
})

describe('community service: suggestions and site administration', () => {
  it('suggests groups from the profile signals minus the groups the viewer is in', async () => {
    const repo = repository()
    const groups = await createCommunityService({ repository: repo }).suggestGroups(viewerId)
    expect(repo.listBySlugs).toHaveBeenCalledWith(viewerId, ['marine-engineers'])
    expect(groups.map((entry) => entry.slug)).toEqual(['marine-engineers'])
  })

  it('creates a group with a unique slug, the chosen owner and an audit event', async () => {
    const repo = repository()
    const created = await createCommunityService({ repository: repo }).createGroup(adminId, {
      name: 'Tanker Professionals', description: 'd', rules: 'r', visibility: 'public', icon: 'ShieldCheck', ownerId,
    })
    expect(created).toEqual({ id: groupId, slug: 'tanker-professionals-2' })
    expect(repo.createGroup).toHaveBeenCalledWith(expect.objectContaining({ slug: 'tanker-professionals-2', createdBy: adminId, ownerId, joinPolicy: 'open', ownerCompanyId: null }))
    expect(repo.insertAuditEvent).toHaveBeenCalledWith(adminId, 'community.group_created', groupId, expect.objectContaining({ owner_id: ownerId, owner_company_id: null, join_policy: 'open' }))
  })

  it('creates an organization-owned community with its join setting (round 9C)', async () => {
    const repo = repository({ listSlugsLike: vi.fn(async () => []) })
    const companyId = '77777777-7777-4777-8777-777777777777'
    const created = await createCommunityService({ repository: repo }).createGroup(viewerId, {
      name: 'Harbour Minds Crew', description: '', rules: '', visibility: 'private', joinPolicy: 'approval', icon: null, ownerId: viewerId, ownerCompanyId: companyId,
    })
    expect(created.slug).toBe('harbour-minds-crew')
    expect(repo.createGroup).toHaveBeenCalledWith(expect.objectContaining({ createdBy: viewerId, ownerId: viewerId, ownerCompanyId: companyId, joinPolicy: 'approval' }))
    expect(repo.insertAuditEvent).toHaveBeenCalledWith(viewerId, 'community.group_created', groupId, { slug: 'harbour-minds-crew', owner_id: viewerId, owner_company_id: companyId, visibility: 'private', join_policy: 'approval' })
  })

  it('archives, restores and hands over ownership with audit events', async () => {
    const repo = repository()
    const service = createCommunityService({ repository: repo })
    await service.archiveGroup(adminId, groupId)
    await service.unarchiveGroup(adminId, groupId)
    await expect(service.setGroupOwner(adminId, groupId, 'asha@example.com')).resolves.toMatchObject({ fullName: 'Asha Singh' })
    expect(repo.setArchived).toHaveBeenNthCalledWith(1, groupId, true)
    expect(repo.setArchived).toHaveBeenNthCalledWith(2, groupId, false)
    expect(repo.setOwner).toHaveBeenCalledWith(groupId, ownerId)
    expect((repo.insertAuditEvent as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[1])).toEqual([
      'community.group_archived', 'community.group_unarchived', 'community.group_owner_changed',
    ])
    const unknownOwner = repository({ findProfileByEmailOrSlug: vi.fn(async () => null) })
    expect(await codeOf(createCommunityService({ repository: unknownOwner }).setGroupOwner(adminId, groupId, 'nobody'))).toBe('group_owner_not_found')
  })
})
