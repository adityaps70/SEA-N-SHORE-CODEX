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

  it('lists organizations the member follows', async () => {
    const repository = createOrganizationWorkspaceRepository({
      query: async (text, values) => {
        expect(text).toContain('join public.organization_follows')
        expect(values).toEqual(['user-1'])
        return [{
          id: 'company-1',
          slug: 'oceanic',
          name: 'Oceanic Shipping',
          logo_path: null,
          company_type: 'Ship Manager',
          website: 'https://oceanic.example.com',
          description: 'Ship management company',
          fleet_summary: null,
          vessel_types: ['Oil Tanker'],
          office_locations: ['Mumbai'],
          is_verified: true,
        }]
      },
    })

    await expect(repository.listFollowedOrganizations('user-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'company-1',
        slug: 'oceanic',
        name: 'Oceanic Shipping',
        verified: true,
      }),
    ])
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

describe('organization workspace details', () => {
  it('maps the stored type code, label and type details for the organization page', async () => {
    const repository = createOrganizationWorkspaceRepository({
      query: async () => [{
        id: 'company-1',
        slug: 'harbour-minds',
        name: 'Harbour Minds',
        logo_path: null,
        company_type: 'Mental-health & wellbeing provider',
        organization_type: 'mental_health_provider',
        organization_details: { servicesOffered: ['counselling'], helpline24x7: true },
        website: null,
        description: null,
        fleet_summary: null,
        vessel_types: [],
        office_locations: [],
        is_verified: false,
      }],
    })
    await expect(repository.getBySlug('harbour-minds')).resolves.toMatchObject({
      companyType: 'Mental-health & wellbeing provider',
      organizationType: 'mental_health_provider',
      details: { servicesOffered: ['counselling'], helpline24x7: true },
    })
  })

  it('maps older organizations without a type code from their free-text label', async () => {
    const repository = createOrganizationWorkspaceRepository({
      query: async () => [{
        id: 'company-1', slug: 'oceanic', name: 'Oceanic', logo_path: null, company_type: 'Crewing Company',
        website: null, description: null, fleet_summary: null, vessel_types: [], office_locations: [], is_verified: true,
      }],
    })
    await expect(repository.getBySlug('oceanic')).resolves.toMatchObject({ companyType: 'Crewing Company', organizationType: 'manning_agency', details: {} })
  })

  it('merges only the wellbeing keys into stored details when branding is saved', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createOrganizationWorkspaceRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return [{ id: 'company-1' }]
      },
    })
    await repository.updateBranding('company-1', {
      website: null,
      description: 'Support for seafarers',
      fleetSummary: null,
      vesselTypes: [],
      officeLocations: ['Manila'],
      supportDetails: { servicesOffered: ['peer_support'], languages: ['English'], helpline24x7: null },
    })
    expect(seen[0]?.text).toContain('jsonb_strip_nulls(organization_details || $7::jsonb)')
    expect(JSON.parse(String(seen[0]?.values?.[6]))).toEqual({ servicesOffered: ['peer_support'], languages: ['English'], helpline24x7: null })

    await repository.updateBranding('company-1', { website: null, description: null, fleetSummary: null, vesselTypes: [], officeLocations: [] })
    expect(seen[1]?.values?.[6]).toBeNull()
  })
})
