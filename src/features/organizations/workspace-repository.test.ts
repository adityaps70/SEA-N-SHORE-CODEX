import { describe, expect, it } from 'vitest'
import { createOrganizationWorkspaceRepository } from './workspace-repository'

describe('organization follows', () => {
  it('loads follower count and viewer follow state', async () => {
    const repository = createOrganizationWorkspaceRepository({
      query: async (text, values) => {
        expect(text).toContain('public.organization_follows')
        expect(values).toEqual(['company-1', 'user-1'])
        return [{ follower_count: 42, following: true }]
      },
    })

    await expect(repository.getFollowState('company-1', 'user-1')).resolves.toEqual({
      followerCount: 42,
      following: true,
    })
  })

  it('follows and unfollows an organization idempotently', async () => {
    const seen: string[] = []
    const repository = createOrganizationWorkspaceRepository({
      query: async (text) => {
        seen.push(text)
        return []
      },
    })

    await repository.followOrganization('user-1', 'company-1')
    await repository.unfollowOrganization('user-1', 'company-1')

    expect(seen[0]).toContain('insert into public.organization_follows')
    expect(seen[0]).toContain('on conflict do nothing')
    expect(seen[1]).toContain('delete from public.organization_follows')
  })
})
