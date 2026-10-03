import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getAwsOwnProfile: vi.fn(),
  updateIdentity: vi.fn(),
  getListableOrganization: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/moderation/repository', () => ({ moderationRepository: { flagContentAutomatically: vi.fn() } }))
vi.mock('./aws-queries', () => ({ getAwsOwnProfile: mocks.getAwsOwnProfile }))
vi.mock('./profile-inline-edit-service', () => ({
  updateProfileAboutSectionWithAurora: vi.fn(),
  updateProfileIdentitySectionWithAurora: mocks.updateIdentity,
  updateProfileProfessionalSectionWithAurora: vi.fn(),
}))
vi.mock('./organization-link-repository', () => ({
  organizationLinkRepository: { getListableOrganization: mocks.getListableOrganization },
}))

import { updateProfileIdentitySection } from './profile-inline-actions'

const profileId = '11111111-1111-4111-8111-111111111111'
const organizationId = '44444444-4444-4444-8444-444444444444'

function identityForm() {
  const form = new FormData()
  form.set('fullName', 'Captain Example')
  form.set('slug', 'capt-example')
  form.set('location', 'Mumbai')
  form.set('headline', 'Master Mariner')
  form.set('contactVisibility', 'members')
  form.set('currentCompany', 'oceanic')
  form.set('currentCompanyId', organizationId)
  return form
}

describe('profile header organization link', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: profileId })
    mocks.getAwsOwnProfile.mockResolvedValue({ id: profileId, slug: 'capt-example', profileType: 'seafarer', persona: 'seafarer' })
    mocks.updateIdentity.mockResolvedValue(true)
  })

  it('saves the linked organization with its listed name', async () => {
    mocks.getListableOrganization.mockResolvedValueOnce({
      id: organizationId,
      slug: 'oceanic-ship-management',
      name: 'Oceanic Ship Management',
      logoUrl: null,
      verified: true,
    })

    await expect(updateProfileIdentitySection({}, identityForm())).resolves.toMatchObject({ success: true })

    expect(mocks.updateIdentity).toHaveBeenCalledWith(
      profileId,
      expect.objectContaining({ currentCompany: 'Oceanic Ship Management', currentCompanyId: organizationId }),
      true,
      { rankSubmitted: false },
    )
  })

  it('refuses an organization that is no longer listed', async () => {
    mocks.getListableOrganization.mockResolvedValueOnce(null)

    const result = await updateProfileIdentitySection({}, identityForm())

    expect(result.fieldErrors?.currentCompany?.[0]).toContain('not listed on Sea N Shore')
    expect(mocks.updateIdentity).not.toHaveBeenCalled()
  })
})
