import { describe, expect, it, vi } from 'vitest'
import { resolveCurrentOrganizationLink, UNLISTED_ORGANIZATION_MESSAGE } from './organization-link-service'
import { createOrganizationSearchService, createSearchRateLimiter } from './organization-search-service'
import {
  createOrganizationHref,
  mapLinkedOrganization,
  organizationReturnHref,
  registerOrganizationHref,
  safeOrganizationReturnPath,
} from './organization-link'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'

describe('organization search service', () => {
  it('skips the database for short terms and trims long ones', async () => {
    const searchListableOrganizations = vi.fn(async () => [])
    const service = createOrganizationSearchService({ repository: { searchListableOrganizations } })

    await expect(service.search(USER_ID, 'a')).resolves.toEqual({ ok: true, query: 'a', organizations: [] })
    expect(searchListableOrganizations).not.toHaveBeenCalled()

    await service.search(USER_ID, 'x'.repeat(200))
    expect(searchListableOrganizations).toHaveBeenCalledWith('x'.repeat(80))
  })

  it('limits each member to a number of searches per minute', async () => {
    let now = 0
    const allow = createSearchRateLimiter({ windowMs: 60_000, maxPerWindow: 2, now: () => now })
    const service = createOrganizationSearchService({ repository: { searchListableOrganizations: vi.fn(async () => []) }, allow })

    expect((await service.search(USER_ID, 'ocean')).ok).toBe(true)
    expect((await service.search(USER_ID, 'ocean')).ok).toBe(true)
    const limited = await service.search(USER_ID, 'ocean')
    expect(limited).toMatchObject({ ok: false, code: 'rate_limited' })
    expect((await service.search('someone-else', 'ocean')).ok).toBe(true)

    now = 61_000
    expect((await service.search(USER_ID, 'ocean')).ok).toBe(true)
  })
})

describe('current organization link validation', () => {
  it('keeps a typed name without an id as plain text', async () => {
    const getListableOrganization = vi.fn()
    await expect(resolveCurrentOrganizationLink({ currentCompany: 'Blue Anchor Marine' }, { getListableOrganization }))
      .resolves.toEqual({ ok: true, data: { currentCompany: 'Blue Anchor Marine', currentCompanyId: undefined } })
    expect(getListableOrganization).not.toHaveBeenCalled()
  })

  it('uses the listed organization name for a linked id', async () => {
    const getListableOrganization = vi.fn(async () => ({
      id: ORGANIZATION_ID,
      slug: 'oceanic-ship-management',
      name: 'Oceanic Ship Management',
      logoUrl: null,
      verified: true,
    }))
    await expect(resolveCurrentOrganizationLink(
      { currentCompany: 'oceanic', currentCompanyId: ORGANIZATION_ID },
      { getListableOrganization },
    )).resolves.toEqual({ ok: true, data: { currentCompany: 'Oceanic Ship Management', currentCompanyId: ORGANIZATION_ID } })
  })

  it('rejects an id that is not listed on Sea N Shore', async () => {
    const getListableOrganization = vi.fn(async () => null)
    await expect(resolveCurrentOrganizationLink(
      { currentCompany: 'Suspended Co', currentCompanyId: ORGANIZATION_ID },
      { getListableOrganization },
    )).resolves.toEqual({ ok: false, fieldErrors: { currentCompany: [UNLISTED_ORGANIZATION_MESSAGE] } })
  })

  it('accepts the member\'s own organization that Sea N Shore is still verifying', async () => {
    const getListableOrganization = vi.fn(async () => null)
    const getOwnPendingOrganization = vi.fn(async () => ({
      id: ORGANIZATION_ID, slug: 'blue-anchor', name: 'Blue Anchor Marine', logoUrl: null, verified: false,
    }))
    await expect(resolveCurrentOrganizationLink(
      { currentCompany: 'blue anchor', currentCompanyId: ORGANIZATION_ID },
      { getListableOrganization, getOwnPendingOrganization },
      { userId: USER_ID },
    )).resolves.toEqual({ ok: true, data: { currentCompany: 'Blue Anchor Marine', currentCompanyId: ORGANIZATION_ID } })
    expect(getOwnPendingOrganization).toHaveBeenCalledWith(USER_ID, ORGANIZATION_ID)

    // Without a signed-in member the pending organization is never considered.
    getOwnPendingOrganization.mockClear()
    await expect(resolveCurrentOrganizationLink(
      { currentCompany: 'blue anchor', currentCompanyId: ORGANIZATION_ID },
      { getListableOrganization, getOwnPendingOrganization },
    )).resolves.toMatchObject({ ok: false })
    expect(getOwnPendingOrganization).not.toHaveBeenCalled()
  })
})

describe('organization link helpers', () => {
  it('builds the create-organization link with the name prefilled', () => {
    expect(createOrganizationHref('Blue Anchor & Sons')).toBe('/organizations?register=1&name=Blue+Anchor+%26+Sons#register-organization')
    expect(createOrganizationHref()).toBe('/organizations?register=1#register-organization')
  })

  it('builds the registration link with the name and a safe return page', () => {
    expect(registerOrganizationHref('Blue Anchor & Sons', '/onboarding')).toBe('/organizations/register?name=Blue+Anchor+%26+Sons&returnTo=%2Fonboarding')
    expect(registerOrganizationHref()).toBe('/organizations/register')
    expect(safeOrganizationReturnPath('/profile/edit')).toBe('/profile/edit')
    expect(safeOrganizationReturnPath(['/onboarding'])).toBe('/onboarding')
    expect(safeOrganizationReturnPath('https://evil.example/onboarding')).toBeNull()
    expect(safeOrganizationReturnPath('//evil.example')).toBeNull()
    expect(organizationReturnHref('/profile/edit', ORGANIZATION_ID)).toBe(`/profile/edit?registered=${ORGANIZATION_ID}#identity`)
    expect(organizationReturnHref('/onboarding', ORGANIZATION_ID)).toBe(`/onboarding?registered=${ORGANIZATION_ID}`)
  })

  it('maps the selected organization JSON defensively', () => {
    expect(mapLinkedOrganization(null)).toBeNull()
    expect(mapLinkedOrganization({ id: ORGANIZATION_ID })).toBeNull()
    expect(mapLinkedOrganization({ id: ORGANIZATION_ID, slug: 'o', name: 'O', has_logo: true, verified: true })).toEqual({
      id: ORGANIZATION_ID,
      slug: 'o',
      name: 'O',
      logoUrl: `/api/company-logo/${ORGANIZATION_ID}`,
      verified: true,
      unclaimed: false,
    })
    expect(mapLinkedOrganization({ id: ORGANIZATION_ID, slug: 'o', name: 'O', has_logo: false, verified: false, unclaimed: true }))
      .toMatchObject({ verified: false, unclaimed: true })
  })
})
