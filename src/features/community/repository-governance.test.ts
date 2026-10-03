import { describe, expect, it, vi } from 'vitest'
import { createCommunityRepository } from './repository'

const groupId = '22222222-2222-4222-8222-222222222222'
const memberId = '33333333-3333-4333-8333-333333333333'
const adminId = '44444444-4444-4444-8444-444444444444'

type Call = [text: string, values?: readonly unknown[]]

function fakeQuery(rows: Record<string, unknown>[] = []) {
  const query = vi.fn(async () => rows)
  return { query, calls: () => query.mock.calls as unknown as Call[] }
}

/** Round 9C governance: platform-admin chips, approve-all and instant admin membership. */
describe('community repository: round 9C governance', () => {
  it('marks members who are Sea N Shore administrators from public.user_roles', async () => {
    const { query, calls } = fakeQuery([
      { profile_id: memberId, slug: 'asha', full_name: 'Asha Singh', headline: null, avatar_path: null, role: 'owner', status: 'active', requested_at: 'r', joined_at: 'j', is_platform_admin: false },
      { profile_id: adminId, slug: 'sn', full_name: 'Sea Admin', headline: null, avatar_path: null, role: 'member', status: 'active', requested_at: 'r', joined_at: 'j', is_platform_admin: true },
    ])
    const members = await createCommunityRepository({ query }).listMembers(groupId)
    const [sql] = calls()[0]
    expect(sql).toContain("exists (select 1 from public.user_roles ur where ur.user_id = m.profile_id and ur.role::text = 'administrator') as is_platform_admin")
    expect(members.map((member) => [member.profileId, member.isPlatformAdmin])).toEqual([[memberId, false], [adminId, true]])
  })

  it('approves every pending request of a group and returns the approved profile ids', async () => {
    const { query, calls } = fakeQuery([{ id: memberId }, { id: adminId }])
    const approved = await createCommunityRepository({ query }).approveAllRequests(groupId)
    const [sql, values] = calls()[0]
    expect(sql).toContain("set status = 'active', joined_at = now()")
    expect(sql).toContain("where group_id = $1 and status = 'pending'")
    expect(sql).toContain('returning profile_id as id')
    expect(values).toEqual([groupId])
    expect(approved).toEqual([memberId, adminId])
  })

  it('activates a platform administrator membership at once, reviving removed rows without touching an existing role', async () => {
    const { query, calls } = fakeQuery([])
    await createCommunityRepository({ query }).activateMembership(groupId, adminId)
    const [sql, values] = calls()[0]
    expect(sql).toContain("values ($1, $2, 'member', 'active', now(), now())")
    expect(sql).toContain('on conflict (group_id, profile_id) do update')
    expect(sql).toContain("set status = 'active'")
    expect(sql).not.toContain("set role")
    expect(values).toEqual([groupId, adminId])
  })
})
