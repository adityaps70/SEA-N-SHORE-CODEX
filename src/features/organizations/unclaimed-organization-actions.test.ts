import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  createUnclaimedOrganization: vi.fn(),
  submitClaim: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./unclaimed-organization-repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('./unclaimed-organization-repository')>()
  return {
    ...original,
    unclaimedOrganizationRepository: {
      createUnclaimedOrganization: mocks.createUnclaimedOrganization,
      submitClaim: mocks.submitClaim,
    },
  }
})

import { UnclaimedOrganizationError } from './unclaimed-organization-repository'
import { createUnclaimedOrganization, submitOrganizationClaim } from './unclaimed-organization-actions'

const COMPANY_ID = '22222222-2222-4222-8222-222222222222'
const organization = { id: COMPANY_ID, slug: 'blue-anchor-abc123', name: 'Blue Anchor', logoUrl: null, verified: false, unclaimed: true }

const claim = {
  organizationName: 'Blue Anchor',
  organizationType: 'union',
  website: null,
  officialEmail: 'director@blueanchor.example',
  officeLocation: 'Kochi, India',
  description: 'Crew welfare and representation for seafarers in Kerala.',
  fleetSummary: null,
  vesselTypes: [],
  applicantRole: 'Director',
  registrationReference: null,
  supportingNotes: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'user-1' })
  mocks.createUnclaimedOrganization.mockResolvedValue(organization)
  mocks.submitClaim.mockResolvedValue({ applicationId: 'application-1', companyId: COMPANY_ID, slug: 'blue-anchor-abc123' })
})

describe('createUnclaimedOrganization action', () => {
  it('validates before signing in or writing', async () => {
    const result = await createUnclaimedOrganization({ name: '', organizationType: '', location: '', website: '' })
    expect(result).toMatchObject({ ok: false, fieldErrors: { name: expect.any(Array), organizationType: expect.any(Array), location: expect.any(Array) } })
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.createUnclaimedOrganization).not.toHaveBeenCalled()
  })

  it('adds the organization for the signed-in member', async () => {
    await expect(createUnclaimedOrganization({ name: 'Blue Anchor', organizationType: 'ship_manager', location: 'Kochi', website: '' }))
      .resolves.toEqual({ ok: true, organization })
    expect(mocks.createUnclaimedOrganization).toHaveBeenCalledWith('user-1', { name: 'Blue Anchor', organizationType: 'ship_manager', location: 'Kochi', website: null })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/organizations')
  })

  it('offers the existing organization when the name is taken', async () => {
    const existing = { id: 'other', slug: 'oceanic', name: 'Oceanic', logoUrl: null, verified: true }
    mocks.createUnclaimedOrganization.mockRejectedValueOnce(new UnclaimedOrganizationError('organization_duplicate_name', existing))

    const result = await createUnclaimedOrganization({ name: 'oceanic', organizationType: 'ship_manager', location: 'Kochi', website: '' })

    expect(result).toMatchObject({ ok: false, existing, fieldErrors: { name: [expect.stringContaining('Oceanic is already on Sea N Shore')] } })
  })

  it('explains the daily limit and connection problems', async () => {
    mocks.createUnclaimedOrganization.mockRejectedValueOnce(new UnclaimedOrganizationError('unclaimed_organization_rate_limited'))
    await expect(createUnclaimedOrganization({ name: 'Blue Anchor', organizationType: 'other', location: 'Kochi', website: '' }))
      .resolves.toMatchObject({ ok: false, error: expect.stringContaining('up to 5 organizations a day') })

    mocks.createUnclaimedOrganization.mockRejectedValueOnce(new Error('timeout'))
    await expect(createUnclaimedOrganization({ name: 'Blue Anchor', organizationType: 'other', location: 'Kochi', website: '' }))
      .resolves.toMatchObject({ ok: false, error: expect.stringContaining('could not add') })
  })
})

describe('submitOrganizationClaim action', () => {
  it('rejects an invalid organization id and invalid details before writing', async () => {
    await expect(submitOrganizationClaim('nope', claim)).resolves.toMatchObject({ ok: false })
    await expect(submitOrganizationClaim(COMPANY_ID, { ...claim, officialEmail: 'not-an-email' })).resolves.toMatchObject({
      ok: false, fieldErrors: { officialEmail: expect.any(Array) },
    })
    expect(mocks.submitClaim).not.toHaveBeenCalled()
  })

  it('sends the claim through the verification review', async () => {
    await expect(submitOrganizationClaim(COMPANY_ID, claim)).resolves.toEqual({ ok: true, applicationId: 'application-1' })
    expect(mocks.submitClaim).toHaveBeenCalledWith('user-1', COMPANY_ID, expect.objectContaining({ organizationName: 'Blue Anchor', officialEmail: 'director@blueanchor.example' }))
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/organizations/blue-anchor-abc123')
  })

  it('explains why a claim cannot be sent', async () => {
    mocks.submitClaim.mockRejectedValueOnce(new UnclaimedOrganizationError('organization_claim_in_review'))
    await expect(submitOrganizationClaim(COMPANY_ID, claim)).resolves.toMatchObject({ ok: false, error: expect.stringContaining('already asked to claim') })

    mocks.submitClaim.mockRejectedValueOnce(new UnclaimedOrganizationError('organization_already_claimed'))
    await expect(submitOrganizationClaim(COMPANY_ID, claim)).resolves.toMatchObject({ ok: false, error: expect.stringContaining('already been claimed') })

    mocks.submitClaim.mockRejectedValueOnce(new UnclaimedOrganizationError('organization_duplicate_name', { id: 'x', slug: 'x', name: 'Other Co', logoUrl: null, verified: true }))
    await expect(submitOrganizationClaim(COMPANY_ID, claim)).resolves.toMatchObject({ ok: false, fieldErrors: { organizationName: [expect.stringContaining('Other Co')] } })
  })
})
