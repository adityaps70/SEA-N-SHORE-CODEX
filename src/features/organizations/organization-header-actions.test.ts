import { describe, expect, it } from 'vitest'
import { MAX_SECONDARY_HEADER_ACTIONS, organizationHeaderActions, type OrganizationHeaderActionInput } from './organization-header-actions'

const visitor: OrganizationHeaderActionInput = {
  canManagePage: false,
  following: false,
  canMessage: true,
  hasWebsite: true,
  canClaim: false,
  canCreateCommunity: false,
  canUpgrade: false,
}

const owner: OrganizationHeaderActionInput = {
  ...visitor,
  canManagePage: true,
  canCreateCommunity: true,
  canUpgrade: true,
}

describe('organizationHeaderActions (round H, H6)', () => {
  it('visitor: Follow first, then Message and Visit website', () => {
    expect(organizationHeaderActions(visitor)).toEqual({ primary: 'follow', secondary: ['message', 'website'], overflow: [] })
  })

  it('visitor who follows: Message becomes the primary and Following stays secondary', () => {
    expect(organizationHeaderActions({ ...visitor, following: true })).toEqual({ primary: 'message', secondary: ['follow', 'website'], overflow: [] })
  })

  it('visitor who follows a page with no contact person keeps Follow as the primary slot', () => {
    expect(organizationHeaderActions({ ...visitor, following: true, canMessage: false })).toEqual({ primary: 'follow', secondary: ['website'], overflow: [] })
  })

  it('unclaimed page: Claim this page comes before Message, and Visit website moves to the menu', () => {
    expect(organizationHeaderActions({ ...visitor, canClaim: true })).toEqual({ primary: 'follow', secondary: ['claim', 'message'], overflow: ['website'] })
  })

  it('owner or administrator: Manage page is the primary; the rest go to the menu after two secondary actions', () => {
    expect(organizationHeaderActions(owner)).toEqual({
      primary: 'manage',
      secondary: ['follow', 'website'],
      overflow: ['message', 'createCommunity', 'upgrade'],
    })
  })

  it('manager without a website: Follow and Message are secondary', () => {
    expect(organizationHeaderActions({ ...owner, hasWebsite: false, canCreateCommunity: false, canUpgrade: false })).toEqual({
      primary: 'manage',
      secondary: ['follow', 'message'],
      overflow: [],
    })
  })

  it('always keeps one primary, at most two secondary, every action exactly once, and Follow visible', () => {
    const flags = ['canManagePage', 'following', 'canMessage', 'hasWebsite', 'canClaim', 'canCreateCommunity', 'canUpgrade'] as const
    for (let mask = 0; mask < 2 ** flags.length; mask += 1) {
      const input = Object.fromEntries(flags.map((flag, index) => [flag, Boolean(mask & (1 << index))])) as OrganizationHeaderActionInput
      const result = organizationHeaderActions(input)
      const all = [result.primary, ...result.secondary, ...result.overflow]
      expect(result.secondary.length).toBeLessThanOrEqual(MAX_SECONDARY_HEADER_ACTIONS)
      expect(new Set(all).size).toBe(all.length)
      expect([result.primary, ...result.secondary]).toContain('follow')
      expect(result.overflow).not.toContain('manage')
      if (input.canMessage) expect(all).toContain('message')
      else expect(all).not.toContain('message')
      if (input.hasWebsite) expect(all).toContain('website')
      if (input.canCreateCommunity) expect(all).toContain('createCommunity')
      if (input.canUpgrade) expect(all).toContain('upgrade')
      if (input.canClaim) expect(all).toContain('claim')
    }
  })
})
