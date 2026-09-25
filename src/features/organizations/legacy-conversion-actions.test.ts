import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getConversion: vi.fn(),
  completeConversion: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./legacy-conversion-repository', () => ({
  legacyOrganizationConversionRepository: {
    getConversion: mocks.getConversion,
    completeConversion: mocks.completeConversion,
  },
}))

import { completeLegacyOrganizationConversion } from './legacy-conversion-actions'

const companyId = '22222222-2222-4222-8222-222222222222'

function form(overrides: Record<string, string> = {}) {
  const data = new FormData()
  data.set('fullName', 'Asha Singh')
  data.set('persona', 'shore_professional')
  data.set('profileIntents', JSON.stringify(['network', 'hire']))
  data.set('headline', 'Marine Manager')
  data.set('strategy', 'existing')
  data.set('companyId', companyId)
  data.set('newOrganizationName', '')
  for (const [key, value] of Object.entries(overrides)) data.set(key, value)
  return data
}

describe('legacy organization conversion action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'user-1', cognitoSub: 'sub-1', email: 'asha@example.com' })
    mocks.getConversion.mockResolvedValue({ status: 'pending' })
    mocks.completeConversion.mockResolvedValue({ companyId })
  })

  it('validates personal identity before authentication or mutation', async () => {
    const result = await completeLegacyOrganizationConversion({}, form({ fullName: 'A' }))

    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.fullName?.[0]).toMatch(/full name/i)
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.completeConversion).not.toHaveBeenCalled()
  })

  it('requires at least one Sea N Shore intent and preserves entered values on validation failure', async () => {
    const result = await completeLegacyOrganizationConversion({}, form({ profileIntents: '[]' }))

    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.profileIntents?.[0]).toMatch(/at least one/i)
    expect(result.values).toMatchObject({
      fullName: 'Asha Singh',
      persona: 'shore_professional',
      headline: 'Marine Manager',
      strategy: 'existing',
      companyId,
    })
  })

  it('converts with the authenticated profile and normalized inputs', async () => {
    await expect(completeLegacyOrganizationConversion({}, form())).resolves.toEqual({
      ok: true,
      companyId,
    })

    expect(mocks.completeConversion).toHaveBeenCalledWith('user-1', {
      fullName: 'Asha Singh',
      persona: 'shore_professional',
      profileIntents: ['network', 'hire'],
      headline: 'Marine Manager',
      strategy: 'existing',
      companyId,
      newOrganizationName: null,
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/home')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/profile')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/hiring/organization')
  })

  it('requires an existing company for link strategy and an organization name for create strategy', async () => {
    const existing = await completeLegacyOrganizationConversion({}, form({ companyId: '' }))
    expect(existing.ok).toBe(false)
    expect(existing.fieldErrors?.companyId?.[0]).toMatch(/organization/i)

    const create = await completeLegacyOrganizationConversion({}, form({
      strategy: 'create',
      companyId: '',
      newOrganizationName: '',
    }))
    expect(create.ok).toBe(false)
    expect(create.fieldErrors?.newOrganizationName?.[0]).toMatch(/organization name/i)
  })

  it('returns a duplicate-company correction that points the user to Claim Existing Organization', async () => {
    mocks.completeConversion.mockRejectedValueOnce(new Error('legacy_company_already_exists'))

    await expect(completeLegacyOrganizationConversion({}, form({
      strategy: 'create',
      companyId: '',
      newOrganizationName: 'Oceanic Shipping',
    }))).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/claim existing organization/i),
    })
  })

  it('fails safely when existing organization authority is no longer sufficient', async () => {
    mocks.completeConversion.mockRejectedValueOnce(new Error('legacy_company_admin_required'))

    await expect(completeLegacyOrganizationConversion({}, form())).resolves.toEqual({
      ok: false,
      error: 'Owner or Administrator access is required to link this organization. Request Administrator access first, then return here.',
    })
  })
})
