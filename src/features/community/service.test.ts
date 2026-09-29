import { describe, expect, it, vi } from 'vitest'
import type { CommunityRepository } from './repository'
import { CommunityServiceError, createCommunityService } from './service'
import type { CommunityGroup, ViewerMembership } from './types'

const viewerId = '11111111-1111-4111-8111-111111111111'
const adminId = '22222222-2222-4222-8222-222222222222'
const ownerId = '55555555-5555-4555-8555-555555555555'
const groupId = '33333333-3333-4333-8333-333333333333'
const postId = '44444444-4444-4444-8444-444444444444'

function group(overrides: Partial<CommunityGroup> = {}): CommunityGroup {
  return {
    id: groupId, slug: 'tanker-professionals', name: 'Tanker Professionals', description: '', rules: '', coverUrl: null, icon: 'ShieldCheck',
    visibility: 'private', memberCount: 4, archived: false, createdBy: ownerId, viewerMembership: null, ...overrides,
  }
}

function repository(overrides: Partial<CommunityRepository> = {}) {
  return {
    getById: vi.fn(async () => group()),
    getMembership: vi.fn(async () => null),
    upsertJoin: vi.fn(async () => true),
    deleteMembership: vi.fn(async () => true),
    approveRequest: vi.fn(async () => true),
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
  it('joins a public group at once without notifying anyone', async () => {
    const repo = repository({ getById: vi.fn(async () => group({ visibility: 'public' })) })
    const result = await createCommunityService({ repository: repo }).joinGroup(viewerId, groupId)
    expect(result.status).toBe('active')
    expect(repo.upsertJoin).toHaveBeenCalledWith(groupId, viewerId, 'active')
    expect(repo.upsertNotification).not.toHaveBeenCalled()
  })

  it('asks to join a private group and notifies every admin and the owner with a dedupe key', async () => {
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

  it('removes members and changes roles for active members', async () => {
    const repo = asAdmin({ getMembership: vi.fn(async (): Promise<ViewerMembership | null> => ({ role: 'member', status: 'active' })) })
    const service = createCommunityService({ repository: repo })
    await service.removeMember(adminId, groupId, viewerId)
    await service.setMemberRole(adminId, groupId, viewerId, 'admin')
    expect(repo.removeMember).toHaveBeenCalledWith(groupId, viewerId)
    expect(repo.setMemberRole).toHaveBeenCalledWith(groupId, viewerId, 'admin')
  })

  it('keeps the name when a group admin edits the description, rules, visibility and icon', async () => {
    const repo = asAdmin()
    await createCommunityService({ repository: repo }).updateGroup(adminId, groupId, { description: 'New', rules: 'Rules', visibility: 'public', icon: 'Wrench' })
    expect(repo.updateGroup).toHaveBeenCalledWith(groupId, { name: 'Tanker Professionals', description: 'New', rules: 'Rules', visibility: 'public', icon: 'Wrench' })
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
    expect(repo.createGroup).toHaveBeenCalledWith(expect.objectContaining({ slug: 'tanker-professionals-2', createdBy: adminId, ownerId }))
    expect(repo.insertAuditEvent).toHaveBeenCalledWith(adminId, 'community.group_created', groupId, expect.objectContaining({ owner_id: ownerId }))
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
