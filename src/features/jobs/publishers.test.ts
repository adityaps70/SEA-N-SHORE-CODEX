import { describe, expect, it } from 'vitest'
import { buildHiringPublisherOptions } from './publishers'
import type { AccessContext } from '@/features/access/policy'

function access(overrides: Partial<AccessContext> = {}): AccessContext {
  return {
    personalPlan: 'free',
    personalEntitlements: [],
    verifications: [],
    organizationMemberships: [],
    accountActive: true,
    ...overrides,
  }
}

const personal = {
  profileId: 'user-1',
  name: 'Asha Singh',
}

const companies = [{
  id: 'company-1',
  name: 'Oceanic Shipping',
  slug: 'oceanic',
  verified: true,
  role: 'recruiter' as const,
}]

describe('hiring publish-as identities', () => {
  it('shows personal identity but keeps a verified free recruiter behind Creator Pro', () => {
    const options = buildHiringPublisherOptions(
      access({ verifications: ['recruiter'] }),
      personal,
      [],
    )

    expect(options).toEqual([expect.objectContaining({
      key: 'personal:user-1',
      kind: 'personal',
      name: 'Asha Singh',
      verified: true,
      canPublish: false,
      blocker: 'upgrade_required',
    })])
  })

  it('allows a verified Creator Pro recruiter to publish as themselves', () => {
    const options = buildHiringPublisherOptions(
      access({ personalPlan: 'creator_pro', verifications: ['recruiter'] }),
      personal,
      [],
    )

    expect(options[0]).toMatchObject({
      kind: 'personal',
      canPublish: true,
      blocker: null,
    })
  })

  it('does not let Creator Pro bypass recruiter verification', () => {
    const options = buildHiringPublisherOptions(
      access({ personalPlan: 'creator_pro' }),
      personal,
      [],
    )

    expect(options[0]).toMatchObject({
      kind: 'personal',
      verified: false,
      canPublish: false,
      blocker: 'verification_required',
    })
  })

  it('allows a verified Organization Pro recruiter to publish as the organization', () => {
    const options = buildHiringPublisherOptions(
      access({
        organizationMemberships: [{
          companyId: 'company-1',
          plan: 'organization_pro',
          role: 'recruiter',
          verified: true,
          entitlements: [],
        }],
      }),
      personal,
      companies,
    )

    expect(options.find((option) => option.kind === 'organization')).toMatchObject({
      key: 'organization:company-1',
      name: 'Oceanic Shipping',
      role: 'recruiter',
      canPublish: true,
      blocker: null,
    })
  })

  it('keeps a trusted organization visible with an upgrade blocker when Organization Pro is missing', () => {
    const options = buildHiringPublisherOptions(
      access({
        organizationMemberships: [{
          companyId: 'company-1',
          plan: 'free',
          role: 'recruiter',
          verified: true,
          entitlements: [],
        }],
      }),
      personal,
      companies,
    )

    expect(options.find((option) => option.kind === 'organization')).toMatchObject({
      canPublish: false,
      blocker: 'upgrade_required',
    })
  })

  it('returns every valid publishing identity so the UI can offer Publish as', () => {
    const options = buildHiringPublisherOptions(
      access({
        personalPlan: 'creator_pro',
        verifications: ['recruiter'],
        organizationMemberships: [{
          companyId: 'company-1',
          plan: 'organization_pro',
          role: 'administrator',
          verified: true,
          entitlements: [],
        }],
      }),
      personal,
      [{ ...companies[0], role: 'administrator' }],
    )

    expect(options.map((option) => option.key)).toEqual([
      'personal:user-1',
      'organization:company-1',
    ])
    expect(options.every((option) => option.canPublish)).toBe(true)
  })
})
