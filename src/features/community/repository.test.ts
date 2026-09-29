import { describe, expect, it, vi } from 'vitest'
import { createCommunityRepository } from './repository'

const viewerId = '11111111-1111-4111-8111-111111111111'
const groupId = '22222222-2222-4222-8222-222222222222'
const memberId = '33333333-3333-4333-8333-333333333333'
const postId = '44444444-4444-4444-8444-444444444444'

type Call = [text: string, values?: readonly unknown[]]

function fakeQuery(rows: Record<string, unknown>[] = []) {
  const query = vi.fn(async () => rows)
  return { query, calls: () => query.mock.calls as unknown as Call[] }
}

function groupRow(overrides: Record<string, unknown> = {}) {
  return {
    id: groupId,
    slug: 'marine-engineers',
    name: 'Marine Engineers',
    description: 'Technical conversations.',
    rules: 'Be kind.',
    cover_path: null,
    icon: 'Wrench',
    visibility: 'public',
    created_by: memberId,
    archived_at: null,
    member_count: '12',
    viewer_role: null,
    viewer_status: null,
    ...overrides,
  }
}

describe('community repository: directory and groups', () => {
  it('lists live groups public first with the viewer membership and escaped search', async () => {
    const { query, calls } = fakeQuery([groupRow({ viewer_role: 'admin', viewer_status: 'active' })])
    const repository = createCommunityRepository({ query })

    const groups = await repository.listDirectory(viewerId, { search: '50%_eng' })

    const [sql, values] = calls()[0]
    expect(sql).toContain('g.archived_at is null')
    expect(sql).toContain("case when g.visibility = 'public' then 0 else 1 end")
    expect(sql).toContain('vm.profile_id = $1')
    expect(sql).toContain("c.status = 'active'")
    expect(values).toEqual([viewerId, 100, '%50\\%\\_eng%'])
    expect(groups).toEqual([expect.objectContaining({
      id: groupId,
      slug: 'marine-engineers',
      memberCount: 12,
      archived: false,
      visibility: 'public',
      coverUrl: null,
      viewerMembership: { role: 'admin', status: 'active' },
    })])
  })

  it('lists the viewer groups: active first, then pending, live groups only', async () => {
    const { query, calls } = fakeQuery([])
    await createCommunityRepository({ query }).listViewerGroups(viewerId)
    const [sql, values] = calls()[0]
    expect(sql).toContain("vm.status in ('active', 'pending')")
    expect(sql).toContain('g.archived_at is null')
    expect(values).toEqual([viewerId])
  })

  it('returns suggested groups in the requested slug order', async () => {
    const { query } = fakeQuery([groupRow({ slug: 'ask-the-community', id: 'b' }), groupRow({ slug: 'tanker-professionals', id: 'a' })])
    const groups = await createCommunityRepository({ query }).listBySlugs(viewerId, ['tanker-professionals', 'ask-the-community', 'missing'])
    expect(groups.map((group) => group.slug)).toEqual(['tanker-professionals', 'ask-the-community'])
  })

  it('loads a group by slug for the viewer and reports archived state', async () => {
    const { query, calls } = fakeQuery([groupRow({ archived_at: '2026-09-01T00:00:00.000Z', visibility: 'private' })])
    const group = await createCommunityRepository({ query }).getBySlug(viewerId, 'marine-engineers')
    expect(calls()[0][1]).toEqual([viewerId, 'marine-engineers'])
    expect(group).toMatchObject({ archived: true, visibility: 'private', viewerMembership: null })
  })

  it('searches live groups by name or description for global search', async () => {
    const { query, calls } = fakeQuery([])
    await createCommunityRepository({ query }).searchGroups(viewerId, 'tanker', 6)
    const [sql, values] = calls()[0]
    expect(sql).toContain('g.name ilike $3')
    expect(sql).toContain('g.description ilike $3')
    expect(values).toEqual([viewerId, 6, '%tanker%'])
    await expect(createCommunityRepository({ query }).searchGroups(viewerId, '   ')).resolves.toEqual([])
  })

  it('search results carry the community photo URL built from icon_path (round 9C)', async () => {
    const { query, calls } = fakeQuery([groupRow({ icon_path: `communities/${groupId}/icon-abc.webp`, cover_path: `communities/${groupId}/cover-def.jpg` })])
    const [group] = await createCommunityRepository({ query }).searchGroups(viewerId, 'marine')
    expect(calls()[0][0]).toContain('g.icon_path')
    expect(group).toMatchObject({
      iconUrl: `/api/community-media/${groupId}/icon?v=icon-abc.webp`,
      coverUrl: `/api/community-media/${groupId}/cover?v=cover-def.jpg`,
    })
  })
})

describe('community repository: images (round 9C)', () => {
  it('replaceImagePath swaps only the requested column and returns the previous key', async () => {
    const { query, calls } = fakeQuery([{ previous_path: 'communities/g/cover-old.jpg' }])
    const repository = createCommunityRepository({ query })

    await expect(repository.replaceImagePath(groupId, 'cover', 'communities/g/cover-new.webp')).resolves.toBe('communities/g/cover-old.jpg')
    const [coverSql, coverValues] = calls()[0]
    expect(coverSql).toContain('cover_path = $2')
    expect(coverSql).not.toContain('icon_path')
    expect(coverSql).toContain('for update')
    expect(coverSql).not.toContain('archived_at')
    expect(coverValues).toEqual([groupId, 'communities/g/cover-new.webp'])

    await repository.replaceImagePath(groupId, 'icon', null)
    const [iconSql, iconValues] = calls()[1]
    expect(iconSql).toContain('icon_path = $2')
    expect(iconSql).not.toContain('cover_path')
    expect(iconValues).toEqual([groupId, null])
  })

  it('replaceImagePath throws when the group does not exist', async () => {
    const { query } = fakeQuery([])
    await expect(createCommunityRepository({ query }).replaceImagePath(groupId, 'icon', 'communities/g/icon.png')).rejects.toThrow('community_group_missing')
  })

  it('getImagePaths returns both keys, or null for an unknown group', async () => {
    const { query, calls } = fakeQuery([{ cover_path: 'communities/g/cover.jpg', icon_path: null }])
    await expect(createCommunityRepository({ query }).getImagePaths(groupId)).resolves.toEqual({ coverPath: 'communities/g/cover.jpg', iconPath: null })
    expect(calls()[0]).toEqual([expect.stringContaining('select cover_path, icon_path from public.community_groups where id = $1'), [groupId]])
    await expect(createCommunityRepository({ query: vi.fn(async () => []) }).getImagePaths(groupId)).resolves.toBeNull()
  })
})

describe('community repository: members', () => {
  it('lists active members owner > admin > member then by name, with search', async () => {
    const { query, calls } = fakeQuery([{
      profile_id: memberId, slug: 'asha', full_name: 'Asha Singh', headline: 'Chief Engineer', avatar_path: null,
      role: 'owner', status: 'active', requested_at: '2026-09-01T00:00:00.000Z', joined_at: '2026-09-01T00:00:00.000Z',
    }])
    const members = await createCommunityRepository({ query }).listMembers(groupId, { search: 'ash' })
    const [sql, values] = calls()[0]
    expect(sql).toContain("m.status = 'active'")
    expect(sql).toContain("case m.role when 'owner' then 0 when 'admin' then 1 else 2 end")
    expect(sql).toContain('lower(p.full_name)')
    expect(sql).toContain('p.full_name ilike $3')
    expect(values).toEqual([groupId, 200, '%ash%'])
    expect(members).toEqual([expect.objectContaining({ profileId: memberId, fullName: 'Asha Singh', role: 'owner', slug: 'asha' })])
  })

  it('lists pending requests oldest first', async () => {
    const { query, calls } = fakeQuery([])
    await createCommunityRepository({ query }).listPendingRequests(groupId)
    const [sql, values] = calls()[0]
    expect(sql).toContain("m.status = 'pending'")
    expect(sql).toContain('order by m.requested_at asc')
    expect(values).toEqual([groupId])
  })

  it('joins with the requested status without touching an existing row', async () => {
    const { query, calls } = fakeQuery([{ status: 'pending' }])
    const inserted = await createCommunityRepository({ query }).upsertJoin(groupId, viewerId, 'pending')
    const [sql, values] = calls()[0]
    expect(sql).toContain('on conflict (group_id, profile_id) do nothing')
    expect(sql).toContain("case when $3 = 'active' then now() else null end")
    expect(values).toEqual([groupId, viewerId, 'pending'])
    expect(inserted).toBe(true)
  })

  it('never deletes, removes or demotes the owner row', async () => {
    const { query, calls } = fakeQuery([])
    const repository = createCommunityRepository({ query })
    await repository.deleteMembership(groupId, viewerId)
    await repository.removeMember(groupId, memberId)
    await repository.setMemberRole(groupId, memberId, 'admin')
    for (const [sql] of calls()) expect(sql).toContain("role <> 'owner'")
    expect(calls()[1][0]).toContain("status = 'removed'")
    expect(calls()[2][1]).toEqual([groupId, memberId, 'admin'])
  })

  it('approves only pending requests and stamps joined_at', async () => {
    const { query, calls } = fakeQuery([{ profile_id: memberId }])
    await expect(createCommunityRepository({ query }).approveRequest(groupId, memberId)).resolves.toBe(true)
    const [sql, values] = calls()[0]
    expect(sql).toContain("status = 'active', joined_at = now()")
    expect(sql).toContain("status = 'pending'")
    expect(values).toEqual([groupId, memberId])
  })

  it('hands the group to a new owner and keeps the old one as an admin', async () => {
    const { query, calls } = fakeQuery([])
    await createCommunityRepository({ query }).setOwner(groupId, memberId)
    expect(calls()[0][0]).toContain("set role = 'admin'")
    expect(calls()[0][0]).toContain("role = 'owner' and profile_id <> $2")
    expect(calls()[1][0]).toContain("'owner', 'active'")
    expect(calls()[1][1]).toEqual([groupId, memberId])
  })
})

describe('community repository: administration and moderation', () => {
  it('creates a group with its owner membership', async () => {
    const query = vi.fn(async (text: string) => (text.includes('insert into public.community_groups') ? [{ id: groupId }] : []))
    const id = await createCommunityRepository({ query }).createGroup({
      name: 'Port Captains', slug: 'port-captains', description: 'd', rules: 'r', visibility: 'private', icon: 'ShieldCheck', createdBy: viewerId, ownerId: memberId,
    })
    expect(id).toBe(groupId)
    const calls = query.mock.calls as unknown as Call[]
    expect(calls[0][1]).toEqual(['Port Captains', 'port-captains', 'd', 'r', 'ShieldCheck', 'private', 'approval', viewerId, null])
    expect(calls[1][0]).toContain("'owner', 'active'")
    expect(calls[1][1]).toEqual([groupId, memberId])
  })

  it('archives and restores through archived_at', async () => {
    const { query, calls } = fakeQuery([{ id: groupId }])
    const repository = createCommunityRepository({ query })
    await repository.setArchived(groupId, true)
    await repository.setArchived(groupId, false)
    expect(calls()[0][0]).toContain('archived_at = coalesce(archived_at, now())')
    expect(calls()[1][0]).toContain('archived_at = null')
  })

  it('lists every group for the admin console with owner, counts and archived filter', async () => {
    const { query, calls } = fakeQuery([{
      id: groupId, slug: 'marine-engineers', name: 'Marine Engineers', description: '', rules: '', icon: null, visibility: 'public',
      member_count: 3, pending_count: '1', owner_id: memberId, owner_name: 'Asha Singh', owner_slug: 'asha', archived_at: null, created_at: '2026-09-01T00:00:00.000Z',
    }])
    const groups = await createCommunityRepository({ query }).listAdminGroups({ search: 'eng', archived: 'live' })
    const [sql, values] = calls()[0]
    expect(sql).toContain("om.role = 'owner'")
    expect(sql).toContain('and g.archived_at is null')
    expect(values).toEqual(['%eng%'])
    expect(groups[0]).toMatchObject({ memberCount: 3, pendingCount: 1, owner: { id: memberId, fullName: 'Asha Singh', slug: 'asha' }, archivedAt: null })
  })

  it('lists the live groups the viewer administers', async () => {
    const { query, calls } = fakeQuery([{ id: groupId }])
    await expect(createCommunityRepository({ query }).listAdministeredGroupIds(viewerId)).resolves.toEqual([groupId])
    const [sql, values] = calls()[0]
    expect(sql).toContain("m.role in ('admin', 'owner')")
    expect(sql).toContain('g.archived_at is null')
    expect(values).toEqual([viewerId])
  })

  it('soft-deletes a group post like an organization admin delete and writes the audit event', async () => {
    const query = vi.fn(async (text: string) => (text.includes('update public.posts') ? [{ id: postId }] : []))
    await expect(createCommunityRepository({ query }).softDeleteGroupPost(viewerId, postId, groupId)).resolves.toBe(true)
    const calls = query.mock.calls as unknown as Call[]
    expect(calls[0][0]).toContain("deletion_reason = 'Removed by a group admin.'")
    expect(calls[0][0]).toContain("purge_after = now() + interval '30 days'")
    expect(calls[0][0]).toContain('group_id = $3')
    expect(calls[0][1]).toEqual([viewerId, postId, groupId])
    expect(calls[1][0]).toContain("'content.post_deleted_by_group_admin', 'post', $2")
    expect(calls[1][1]).toEqual([viewerId, postId, groupId])
  })

  it('does not write an audit event when nothing was deleted', async () => {
    const { query, calls } = fakeQuery([])
    await expect(createCommunityRepository({ query }).softDeleteGroupPost(viewerId, postId, groupId)).resolves.toBe(false)
    expect(calls()).toHaveLength(1)
  })

  it('upserts group notifications on the dedupe key with the group reference', async () => {
    const { query, calls } = fakeQuery([])
    await createCommunityRepository({ query }).upsertNotification({
      recipientId: memberId, actorId: viewerId, type: 'group_join_request', groupId, dedupeKey: `group-join-request:${groupId}:${viewerId}:${memberId}`,
    })
    const [sql, values] = calls()[0]
    expect(sql).toContain('on conflict (recipient_id, dedupe_key) where dedupe_key is not null')
    expect(sql).toContain('read_at = null')
    expect(values).toEqual([memberId, viewerId, 'group_join_request', `group-join-request:${groupId}:${viewerId}:${memberId}`, groupId])
  })

  it('reads suggestion signals from the maritime profile and persona', async () => {
    const { query, calls } = fakeQuery([{ rank: 'Chief Engineer', vessel_types: ['Tanker'], persona: 'seafarer' }])
    await expect(createCommunityRepository({ query }).getSuggestionSignals(viewerId)).resolves.toEqual({ rank: 'Chief Engineer', vesselTypes: ['Tanker'], persona: 'seafarer' })
    expect(calls()[0][0]).toContain('public.maritime_profiles mp on mp.user_id = p.id')
    const empty = createCommunityRepository({ query: async () => [] })
    await expect(empty.getSuggestionSignals(viewerId)).resolves.toEqual({ rank: null, vesselTypes: [], persona: null })
  })

  it('finds an owner by email or handle, ignoring case and a leading @', async () => {
    const { query, calls } = fakeQuery([{ id: memberId, full_name: 'Asha Singh', slug: 'asha' }])
    await expect(createCommunityRepository({ query }).findProfileByEmailOrSlug('@Asha')).resolves.toEqual({ id: memberId, fullName: 'Asha Singh', slug: 'asha' })
    const [sql, values] = calls()[0]
    expect(sql).toContain('lower(ia.email) = $1')
    expect(sql).toContain("p.account_status = 'active'")
    expect(values).toEqual(['asha'])
  })
})
