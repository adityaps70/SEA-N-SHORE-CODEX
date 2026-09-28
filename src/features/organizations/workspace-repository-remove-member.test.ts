import { describe, expect, it } from 'vitest'
import { createOrganizationWorkspaceRepository } from './workspace-repository'

const companyId = '22222222-2222-4222-8222-222222222222'
const ownerId = '11111111-1111-4111-8111-111111111111'
const adminId = '33333333-3333-4333-8333-333333333333'
const memberId = '44444444-4444-4444-8444-444444444444'
const secondOwnerId = '55555555-5555-4555-8555-555555555555'

type Row = { user_id: string; role: string }

/** A fake transaction that answers the member lock query and records every statement. */
function repositoryWith(members: Row[]) {
  const statements: { text: string; values: readonly unknown[] }[] = []
  const repository = createOrganizationWorkspaceRepository({
    query: async () => [],
    transaction: async (fn) => fn({
      async query<T>(text: string, values: readonly unknown[] = []) {
        statements.push({ text, values })
        if (text.includes('for update')) return { rows: members as unknown as T[] }
        if (text.includes('delete from public.company_members')) {
          const target = members.find((row) => row.user_id === values[1])
          return { rows: (target ? [{ user_id: target.user_id }] : []) as unknown as T[] }
        }
        return { rows: [] as T[] }
      },
    }),
  })
  return { repository, statements }
}

const team: Row[] = [
  { user_id: ownerId, role: 'owner' },
  { user_id: adminId, role: 'administrator' },
  { user_id: memberId, role: 'member' },
]

describe('organizationWorkspaceRepository.removeMember', () => {
  it('lets an administrator remove a member, locking the team rows and writing an audit event', async () => {
    const { repository, statements } = repositoryWith(team)
    await expect(repository.removeMember(adminId, companyId, memberId)).resolves.toBe(true)
    expect(statements[0]!.text).toContain('for update')
    expect(statements[0]!.values).toEqual([companyId])
    const remove = statements.find((statement) => statement.text.includes('delete from public.company_members'))
    expect(remove?.values).toEqual([companyId, memberId])
    const audit = statements.find((statement) => statement.text.includes('audit_events'))
    expect(audit?.text).toContain("'organization.member_removed'")
    expect(JSON.parse(String(audit?.values[2]))).toEqual({ memberId, previousRole: 'member', self: false })
  })

  it('refuses people who are not an owner or administrator', async () => {
    const { repository, statements } = repositoryWith([...team, { user_id: '66666666-6666-4666-8666-666666666666', role: 'recruiter' }])
    await expect(repository.removeMember('66666666-6666-4666-8666-666666666666', companyId, memberId)).rejects.toThrow('organization_member_remove_forbidden')
    await expect(repository.removeMember('77777777-7777-4777-8777-777777777777', companyId, memberId)).rejects.toThrow('organization_member_remove_forbidden')
    expect(statements.some((statement) => statement.text.includes('delete from'))).toBe(false)
  })

  it('never removes the last owner, including the owner leaving themselves', async () => {
    const { repository, statements } = repositoryWith(team)
    await expect(repository.removeMember(ownerId, companyId, ownerId)).rejects.toThrow('organization_last_owner')
    expect(statements.some((statement) => statement.text.includes('delete from'))).toBe(false)
  })

  it('does not let an administrator remove an owner', async () => {
    const { repository } = repositoryWith([...team, { user_id: secondOwnerId, role: 'owner' }])
    await expect(repository.removeMember(adminId, companyId, ownerId)).rejects.toThrow('organization_member_remove_forbidden')
  })

  it('lets one of two owners leave, and an owner remove another owner', async () => {
    const withTwoOwners = [...team, { user_id: secondOwnerId, role: 'owner' }]
    await expect(repositoryWith(withTwoOwners).repository.removeMember(ownerId, companyId, ownerId)).resolves.toBe(true)
    await expect(repositoryWith(withTwoOwners).repository.removeMember(ownerId, companyId, secondOwnerId)).resolves.toBe(true)
  })

  it('lets an administrator leave the team', async () => {
    const { repository, statements } = repositoryWith(team)
    await expect(repository.removeMember(adminId, companyId, adminId)).resolves.toBe(true)
    const audit = statements.find((statement) => statement.text.includes('audit_events'))
    expect(JSON.parse(String(audit?.values[2]))).toMatchObject({ self: true })
  })

  it('reports a member who is not on the team', async () => {
    const { repository } = repositoryWith(team)
    await expect(repository.removeMember(adminId, companyId, secondOwnerId)).rejects.toThrow('organization_member_not_found')
  })
})
