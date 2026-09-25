import { describe, expect, it, vi } from 'vitest'
import { createLegacyOrganizationConversionRepository } from './legacy-conversion-repository'

const profileId = '11111111-1111-4111-8111-111111111111'
const existingCompanyId = '22222222-2222-4222-8222-222222222222'

describe('legacy organization conversion repository', () => {
  it('loads a pending conversion with the preserved legacy organization snapshot and eligible owner/admin memberships', async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes('from public.legacy_organization_conversions')) {
        return [{
          profile_id: profileId,
          status: 'pending',
          legacy_snapshot: {
            organizationName: 'Oceanic Shipping',
            headline: 'Ship Management Company',
            summary: 'Legacy organization description.',
            location: 'Mumbai',
            avatarPath: 'profiles/legacy/logo.webp',
          },
          company_id: null,
          completed_at: null,
        }]
      }
      if (text.includes('from public.company_members')) {
        return [{
          company_id: existingCompanyId,
          company_name: 'Oceanic Shipping',
          company_slug: 'oceanic-shipping',
          company_verified: true,
          member_role: 'administrator',
        }]
      }
      return []
    })

    const repository = createLegacyOrganizationConversionRepository({ query })

    await expect(repository.getConversion(profileId)).resolves.toEqual({
      status: 'pending',
      legacyOrganization: {
        name: 'Oceanic Shipping',
        headline: 'Ship Management Company',
        summary: 'Legacy organization description.',
        location: 'Mumbai',
        avatarPath: 'profiles/legacy/logo.webp',
      },
      linkedCompanyId: null,
      completedAt: null,
      eligibleOrganizations: [{
        id: existingCompanyId,
        name: 'Oceanic Shipping',
        slug: 'oceanic-shipping',
        verified: true,
        role: 'administrator',
      }],
    })
  })

  it('converts the profile to a human identity while linking an existing owner/admin organization', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.legacy_organization_conversions') && text.includes('for update')) {
        return [{
          profile_id: profileId,
          status: 'pending',
          legacy_snapshot: { organizationName: 'Oceanic Shipping' },
          company_id: null,
        }]
      }
      if (text.includes('from public.company_members') && text.includes('for update')) {
        return [{ role: 'administrator', approved_at: '2026-09-01T00:00:00.000Z' }]
      }
      return []
    })
    const repository = createLegacyOrganizationConversionRepository({
      query,
      transaction: async (work) => work(query),
    })

    await expect(repository.completeConversion(profileId, {
      fullName: 'Asha Singh',
      persona: 'shore_professional',
      profileIntents: ['network', 'hire'],
      headline: 'Marine Manager',
      strategy: 'existing',
      companyId: existingCompanyId,
      newOrganizationName: null,
    })).resolves.toEqual({ companyId: existingCompanyId })

    const profileUpdate = seen.find((entry) => entry.text.includes('update public.profiles'))
    expect(profileUpdate?.text).toContain('identity_root = null')
    expect(profileUpdate?.text).toContain('primary_identity = null')
    expect(profileUpdate?.values).toContain('Asha Singh')
    expect(profileUpdate?.values).toContain('shore_professional')
    expect(profileUpdate?.values).toContain('Marine Manager')

    expect(seen.some((entry) => entry.text.includes('insert into public.companies'))).toBe(false)
    expect(seen.some((entry) => entry.text.includes('legacy_organization_conversions') && entry.text.includes("status = 'completed'"))).toBe(true)
    expect(seen.some((entry) => entry.text.includes('legacy_organization.converted'))).toBe(true)
  })

  it('creates a new unverified organization only after explicit confirmation and transfers legacy organization presentation data', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.legacy_organization_conversions') && text.includes('for update')) {
        return [{
          profile_id: profileId,
          status: 'pending',
          legacy_snapshot: {
            organizationName: 'Oceanic Shipping',
            headline: 'Ship Management Company',
            summary: 'Legacy organization description.',
            location: 'Mumbai',
            avatarPath: 'profiles/legacy/logo.webp',
          },
          company_id: null,
        }]
      }
      if (text.includes('from public.companies') && text.includes('lower(name)')) return []
      if (text.includes('insert into public.companies')) return [{ id: existingCompanyId }]
      return []
    })
    const repository = createLegacyOrganizationConversionRepository({
      query,
      transaction: async (work) => work(query),
    })

    await expect(repository.completeConversion(profileId, {
      fullName: 'Asha Singh',
      persona: 'recruiter_hr',
      profileIntents: ['hire', 'network'],
      headline: 'Crewing Director',
      strategy: 'create',
      companyId: null,
      newOrganizationName: 'Oceanic Shipping',
    })).resolves.toEqual({ companyId: existingCompanyId })

    const companyInsert = seen.find((entry) => entry.text.includes('insert into public.companies'))
    expect(companyInsert?.text).toContain('logo_path')
    expect(companyInsert?.values).toContain('Oceanic Shipping')
    expect(companyInsert?.values).toContain('Legacy organization description.')
    expect(companyInsert?.values).toContain('profiles/legacy/logo.webp')

    const membership = seen.find((entry) => entry.text.includes('insert into public.company_members'))
    expect(membership?.values).toContain('owner')
    expect(membership?.text).toContain('approved_at')

    const profileUpdate = seen.find((entry) => entry.text.includes('update public.profiles'))
    expect(profileUpdate?.text).toContain('avatar_path = null')
    expect(profileUpdate?.text).toContain('summary = null')
  })

  it('refuses to create a duplicate organization with the same normalized name', async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes('from public.legacy_organization_conversions') && text.includes('for update')) {
        return [{
          profile_id: profileId,
          status: 'pending',
          legacy_snapshot: { organizationName: 'Oceanic Shipping' },
          company_id: null,
        }]
      }
      if (text.includes('from public.companies') && text.includes('lower(name)')) {
        return [{ id: existingCompanyId }]
      }
      return []
    })
    const repository = createLegacyOrganizationConversionRepository({
      query,
      transaction: async (work) => work(query),
    })

    await expect(repository.completeConversion(profileId, {
      fullName: 'Asha Singh',
      persona: 'shore_professional',
      profileIntents: ['network'],
      headline: 'Marine Manager',
      strategy: 'create',
      companyId: null,
      newOrganizationName: '  OCEANIC SHIPPING ',
    })).rejects.toThrow('legacy_company_already_exists')
  })

  it('does not allow an unapproved or recruiter-only membership to satisfy legacy organization ownership conversion', async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes('from public.legacy_organization_conversions') && text.includes('for update')) {
        return [{
          profile_id: profileId,
          status: 'pending',
          legacy_snapshot: { organizationName: 'Oceanic Shipping' },
          company_id: null,
        }]
      }
      if (text.includes('from public.company_members') && text.includes('for update')) {
        return [{ role: 'recruiter', approved_at: '2026-09-01T00:00:00.000Z' }]
      }
      return []
    })
    const repository = createLegacyOrganizationConversionRepository({
      query,
      transaction: async (work) => work(query),
    })

    await expect(repository.completeConversion(profileId, {
      fullName: 'Asha Singh',
      persona: 'recruiter_hr',
      profileIntents: ['hire'],
      headline: 'Crewing Director',
      strategy: 'existing',
      companyId: existingCompanyId,
      newOrganizationName: null,
    })).rejects.toThrow('legacy_company_admin_required')
  })
})
