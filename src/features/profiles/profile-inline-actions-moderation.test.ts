import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getAwsOwnProfile: vi.fn(),
  updateAbout: vi.fn(),
  updateIdentity: vi.fn(),
  updateProfessional: vi.fn(),
  flagContentAutomatically: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/moderation/repository', () => ({
  moderationRepository: { flagContentAutomatically: mocks.flagContentAutomatically },
}))
vi.mock('./aws-queries', () => ({ getAwsOwnProfile: mocks.getAwsOwnProfile }))
vi.mock('./profile-inline-edit-service', () => ({
  updateProfileAboutSectionWithAurora: mocks.updateAbout,
  updateProfileIdentitySectionWithAurora: mocks.updateIdentity,
  updateProfileProfessionalSectionWithAurora: mocks.updateProfessional,
}))

import { updateProfileAboutSection } from './profile-inline-actions'

const profileId = '11111111-1111-4111-8111-111111111111'

describe('profile inline automated moderation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: profileId })
    mocks.getAwsOwnProfile.mockResolvedValue({
      id: profileId,
      slug: 'capt-example',
      profileType: 'seafarer',
    })
    mocks.updateAbout.mockResolvedValue(undefined)
    mocks.flagContentAutomatically.mockResolvedValue(undefined)
  })

  it('blocks high-confidence unsafe about text before saving', async () => {
    const form = new FormData()
    form.set('summary', 'Send your OTP and password to verify your account immediately.')
    form.set('skills', 'Navigation')

    const result = await updateProfileAboutSection({}, form)

    expect(result.error).toMatch(/community safety rules/i)
    expect(mocks.updateAbout).not.toHaveBeenCalled()
  })

  it('flags review-level about text after saving', async () => {
    const form = new FormData()
    form.set('summary', 'You are a useless idiot and should never work on a ship.')
    form.set('skills', 'Navigation')

    await expect(updateProfileAboutSection({}, form)).resolves.toMatchObject({ success: true })

    expect(mocks.updateAbout).toHaveBeenCalled()
    expect(mocks.flagContentAutomatically).toHaveBeenCalledWith(expect.objectContaining({
      targetType: 'profile',
      targetId: profileId,
      reason: 'harassment',
      details: expect.stringContaining('[AUTOMATED MODERATION]'),
    }))
  })
})
