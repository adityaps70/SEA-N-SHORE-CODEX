import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrganizationApplicationInput } from './repository'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  submitOrganizationApplication: vi.fn(),
  resubmitOrganizationApplication: vi.fn(),
  searchCompanies: vi.fn(),
  requestCompanyAccess: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('./repository')>()
  return {
    ...original,
    organizationRepository: {
      submitOrganizationApplication: mocks.submitOrganizationApplication,
      resubmitOrganizationApplication: mocks.resubmitOrganizationApplication,
      searchCompanies: mocks.searchCompanies,
      requestCompanyAccess: mocks.requestCompanyAccess,
    },
  }
})

import { requestOrganizationAccess, resubmitOrganizationApplication, searchOrganizations, submitOrganizationApplication } from './actions'

const applicationId = '22222222-2222-4222-8222-222222222222'

function validInput(overrides: Partial<OrganizationApplicationInput> = {}): OrganizationApplicationInput {
  return {
    organizationName: ' Oceanic Shipping Pvt Ltd ',
    organizationType: ' Ship Management Company ',
    website: ' https://oceanic.example.com ',
    officialEmail: ' Hiring@Oceanic.Example.com ',
    officeLocation: ' Mumbai, India ',
    description: ' Ship management and crewing company serving international vessel owners. ',
    fleetSummary: ' 12 managed tankers and bulk carriers. ',
    vesselTypes: ['Oil Tanker', ' oil tanker ', 'Bulk Carrier'],
    applicantRole: ' Managing Director ',
    registrationReference: ' CIN-12345 ',
    supportingNotes: ' Please verify our company profile for maritime hiring. ',
    ...overrides,
  }
}

describe('organization application server actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'user-1', cognitoSub: 'sub-1', email: 'founder@example.com' })
    mocks.submitOrganizationApplication.mockResolvedValue({ companyId: 'company-1', applicationId })
    mocks.resubmitOrganizationApplication.mockResolvedValue(true)
    mocks.searchCompanies.mockResolvedValue([])
    mocks.requestCompanyAccess.mockResolvedValue({ requestId: '44444444-4444-4444-8444-444444444444' })
  })

  it('validates before authentication or repository mutation', async () => {
    const result = await submitOrganizationApplication(validInput({ officialEmail: 'not-an-email' }))

    expect(result.ok).toBe(false)
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.submitOrganizationApplication).not.toHaveBeenCalled()
  })

  it('returns field-specific correction guidance for invalid organization onboarding data', async () => {
    const result = await submitOrganizationApplication(validInput({ officialEmail: 'not-an-email' }))

    expect(result).toMatchObject({
      ok: false,
      error: 'Please correct the highlighted information and try again.',
      fieldErrors: {
        officialEmail: [expect.stringMatching(/valid work email/i)],
      },
    })
  })

  it('rejects an invalid organization website before authentication', async () => {
    const result = await submitOrganizationApplication(validInput({ website: 'not-a-url' }))

    expect(result.ok).toBe(false)
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.submitOrganizationApplication).not.toHaveBeenCalled()
  })

  it('submits normalized organization data with the authenticated user', async () => {
    await expect(submitOrganizationApplication(validInput())).resolves.toEqual({ ok: true, applicationId })

    expect(mocks.submitOrganizationApplication).toHaveBeenCalledWith('user-1', {
      organizationName: 'Oceanic Shipping Pvt Ltd',
      organizationType: 'Ship Management Company',
      website: 'https://oceanic.example.com',
      officialEmail: 'hiring@oceanic.example.com',
      officeLocation: 'Mumbai, India',
      description: 'Ship management and crewing company serving international vessel owners.',
      fleetSummary: '12 managed tankers and bulk carriers.',
      vesselTypes: ['Oil Tanker', 'Bulk Carrier'],
      applicantRole: 'Managing Director',
      registrationReference: 'CIN-12345',
      supportingNotes: 'Please verify our company profile for maritime hiring.',
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/hiring')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/hiring/organization')
  })

  it('rejects invalid application ids before authentication on resubmission', async () => {
    const result = await resubmitOrganizationApplication('invalid', validInput())

    expect(result.ok).toBe(false)
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.resubmitOrganizationApplication).not.toHaveBeenCalled()
  })

  it('resubmits with authenticated identity and refreshes hiring state', async () => {
    await expect(resubmitOrganizationApplication(applicationId, validInput())).resolves.toEqual({ ok: true })

    expect(mocks.resubmitOrganizationApplication).toHaveBeenCalledWith('user-1', applicationId, expect.objectContaining({
      officialEmail: 'hiring@oceanic.example.com',
      vesselTypes: ['Oil Tanker', 'Bulk Carrier'],
    }))
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/hiring')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/hiring/organization')
  })

  it('returns safe copy for forbidden resubmission state', async () => {
    mocks.resubmitOrganizationApplication.mockRejectedValueOnce(new Error('organization_resubmit_forbidden'))

    await expect(resubmitOrganizationApplication(applicationId, validInput())).resolves.toEqual({
      ok: false,
      error: 'This organization application cannot be resubmitted in its current state.',
    })
  })

  it('searches existing organizations only for an authenticated member', async () => {
    mocks.searchCompanies.mockResolvedValueOnce([{
      id: '33333333-3333-4333-8333-333333333333',
      slug: 'oceanic',
      name: 'Oceanic Shipping',
      companyType: 'Ship Manager',
      verified: true,
      website: 'https://oceanic.example.com',
    }])

    await expect(searchOrganizations('  Oceanic  ')).resolves.toEqual({
      ok: true,
      organizations: [expect.objectContaining({ name: 'Oceanic Shipping', verified: true })],
    })
    expect(mocks.requireAwsUser).toHaveBeenCalledTimes(1)
    expect(mocks.searchCompanies).toHaveBeenCalledWith('Oceanic')
  })

  it('validates organization access requests before authentication', async () => {
    await expect(requestOrganizationAccess('bad-id', 'administrator', 'Director')).resolves.toMatchObject({ ok: false })
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.requestCompanyAccess).not.toHaveBeenCalled()
  })

  it('requests recruiter or admin access without granting membership directly', async () => {
    const companyId = '33333333-3333-4333-8333-333333333333'
    await expect(requestOrganizationAccess(companyId, 'administrator', 'I am the company director.')).resolves.toEqual({
      ok: true,
      requestId: '44444444-4444-4444-8444-444444444444',
    })

    expect(mocks.requestCompanyAccess).toHaveBeenCalledWith(
      'user-1',
      companyId,
      'administrator',
      'I am the company director.',
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/hiring/organization')
  })

  it('returns useful copy for an already-pending or existing organization membership', async () => {
    const companyId = '33333333-3333-4333-8333-333333333333'
    mocks.requestCompanyAccess.mockRejectedValueOnce(new Error('organization_access_request_exists'))
    await expect(requestOrganizationAccess(companyId, 'recruiter', null)).resolves.toEqual({
      ok: false,
      error: 'You already have a pending access request for this organization and role.',
    })

    mocks.requestCompanyAccess.mockRejectedValueOnce(new Error('organization_membership_exists'))
    await expect(requestOrganizationAccess(companyId, 'member', null)).resolves.toEqual({
      ok: false,
      error: 'You already belong to this organization.',
    })
  })

})
