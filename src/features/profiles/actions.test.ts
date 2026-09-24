import { beforeEach, describe, expect, it, vi } from 'vitest'

const moderationMocks = vi.hoisted(() => ({
  flagContentAutomatically: vi.fn(async () => undefined),
}))
import { requireAwsUser } from '@/features/auth/aws-queries'
import { getAwsOwnProfile } from './aws-queries'
import { completeOnboardingWithAurora } from './onboarding-service'
import { updateProfileWithAurora } from './profile-edit-service'
import { completeOnboarding, updateProfile } from './actions'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
}))
vi.mock('@/features/moderation/repository', () => ({
  moderationRepository: { flagContentAutomatically: moderationMocks.flagContentAutomatically },
}))
vi.mock('@/features/auth/aws-queries', () => ({
  requireAwsUser: vi.fn(async () => ({
    id: '11111111-1111-4111-8111-111111111111',
    cognitoSub: 'cognito-subject-not-an-app-id',
    email: 'viewer@example.com',
  })),
}))
vi.mock('./aws-queries', () => ({
  getAwsOwnProfile: vi.fn(async () => ({
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'captain-example',
    profileType: 'seafarer',
    identityRoot: 'professional',
    fullName: 'Captain Example',
    avatarPath: null,
    location: 'Mumbai',
    headline: 'Master Mariner',
    summary: 'Experienced maritime professional focused on safe tanker operations.',
    rank: 'Master',
    currentCompany: 'Example Shipping',
    currentVessel: 'MV Example',
    sailingExperienceYears: 18,
    vesselTypes: ['Oil Tanker'],
    tradingAreas: ['Worldwide'],
    shoreCareerPreference: false,
    availability: 'Open to mentoring',
    skills: ['Navigation'],
    contactVisibility: 'members',
    onboardingCompletedAt: '2026-09-01T00:00:00.000Z',
  })),
}))
vi.mock('./onboarding-service', () => ({
  completeOnboardingWithAurora: vi.fn(async () => true),
}))
vi.mock('./profile-edit-service', () => ({
  updateProfileWithAurora: vi.fn(async () => true),
}))

const viewerId = '11111111-1111-4111-8111-111111111111'
const mockedRequireAwsUser = vi.mocked(requireAwsUser)
const mockedGetOwnProfile = vi.mocked(getAwsOwnProfile)
const mockedCompleteOnboarding = vi.mocked(completeOnboardingWithAurora)
const mockedUpdateProfile = vi.mocked(updateProfileWithAurora)

function validForm() {
  const formData = new FormData()
  formData.set('profileType', 'seafarer')
  formData.set('fullName', ' Captain Example ')
  formData.set('slug', ' Captain-Example ')
  formData.set('location', ' Mumbai ')
  formData.set('headline', ' Master Mariner and tanker specialist ')
  formData.set('summary', ' Experienced maritime professional focused on safe tanker operations. ')
  formData.set('contactVisibility', 'members')
  formData.set('skills', 'Navigation, SIRE 2.0, navigation')
  formData.set('rank', ' Master ')
  formData.set('currentCompany', ' Example Shipping ')
  formData.set('currentVessel', ' MV Example ')
  formData.set('sailingExperienceYears', '18')
  formData.set('vesselTypes', 'Oil Tanker, oil tanker')
  formData.set('tradingAreas', 'Worldwide')
  formData.set('shoreCareerPreference', 'false')
  formData.set('availability', ' Open to mentoring ')
  return formData
}

describe('profile onboarding action', () => {
  beforeEach(() => vi.clearAllMocks())

  it('validates before authentication or mutation', async () => {
    const formData = validForm()
    formData.set('slug', 'not a valid slug!')

    const result = await completeOnboarding({}, formData)

    expect(result.fieldErrors?.slug).toBeTruthy()
    expect(mockedRequireAwsUser).not.toHaveBeenCalled()
    expect(mockedCompleteOnboarding).not.toHaveBeenCalled()
  })

  it('blocks high-confidence unsafe profile text before onboarding mutation', async () => {
    const formData = validForm()
    formData.set('summary', 'Send your OTP and password to verify your account immediately.')

    const result = await completeOnboarding({}, formData)

    expect(result.error).toMatch(/community safety rules/i)
    expect(mockedCompleteOnboarding).not.toHaveBeenCalled()
  })

  it('flags review-level profile text in the centralized moderation queue', async () => {
    const formData = validForm()
    formData.set('summary', 'You are a useless idiot and should never work on a ship.')

    await expect(completeOnboarding({}, formData)).rejects.toThrow('NEXT_REDIRECT:/home')

    expect(moderationMocks.flagContentAutomatically).toHaveBeenCalledWith(expect.objectContaining({
      targetType: 'profile',
      targetId: viewerId,
      reason: 'harassment',
      details: expect.stringContaining('[AUTOMATED MODERATION]'),
    }))
  })

  it('passes normalized onboarding data with the permanent profile UUID to Aurora', async () => {
    await expect(completeOnboarding({}, validForm())).rejects.toThrow('NEXT_REDIRECT:/home')

    expect(mockedCompleteOnboarding).toHaveBeenCalledWith(viewerId, expect.objectContaining({
      profileType: 'seafarer',
      fullName: 'Captain Example',
      slug: 'captain-example',
      location: 'Mumbai',
      skills: ['Navigation', 'SIRE 2.0'],
      rank: 'Master',
      vesselTypes: ['Oil Tanker'],
    }))
  })

  it('returns the username collision message', async () => {
    mockedCompleteOnboarding.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: '23505' }))

    const result = await completeOnboarding({}, validForm())

    expect(result.fieldErrors?.slug).toEqual(['That username is already in use.'])
  })

  it('preserves generic safe error copy for unavailable or failed onboarding', async () => {
    mockedCompleteOnboarding.mockRejectedValueOnce(new Error('onboarding_unavailable'))

    const result = await completeOnboarding({}, validForm())

    expect(result.error).toBe('We could not save your profile. Your entries are still here; please try again.')
  })
})

describe('completed profile update action', () => {
  beforeEach(() => vi.clearAllMocks())

  it('authenticates and loads the stored profile before validating editable fields', async () => {
    const formData = validForm()
    formData.set('slug', 'not a valid slug!')

    const result = await updateProfile({}, formData)

    expect(result.fieldErrors?.slug).toBeTruthy()
    expect(mockedRequireAwsUser).toHaveBeenCalledTimes(1)
    expect(mockedGetOwnProfile).toHaveBeenCalledTimes(1)
    expect(mockedRequireAwsUser.mock.invocationCallOrder[0]).toBeLessThan(mockedGetOwnProfile.mock.invocationCallOrder[0])
    expect(mockedUpdateProfile).not.toHaveBeenCalled()
  })

  it('preserves the stored profile type and redirects back to My Profile after save', async () => {
    const formData = validForm()
    formData.set('profileType', 'mentor')

    await expect(updateProfile({}, formData)).rejects.toThrow('NEXT_REDIRECT:/profile')

    expect(mockedRequireAwsUser).toHaveBeenCalledTimes(1)
    expect(mockedUpdateProfile).toHaveBeenCalledWith(
      viewerId,
      expect.objectContaining({
        profileType: 'seafarer',
        fullName: 'Captain Example',
        slug: 'captain-example',
        headline: 'Master Mariner and tanker specialist',
        skills: ['Navigation', 'SIRE 2.0'],
      }),
      true,
    )
  })

  it('preserves current company for professional identities with non-maritime legacy profile types', async () => {
    mockedGetOwnProfile.mockResolvedValueOnce({
      id: viewerId,
      slug: 'mentor-example',
      profileType: 'mentor',
      identityRoot: 'professional',
      fullName: 'Mentor Example',
      avatarPath: null,
      location: 'Mumbai',
      headline: 'Maritime Mentor',
      summary: 'Experienced maritime mentor supporting safer professional development.',
      rank: null,
      currentCompany: 'Example Shipping',
      currentVessel: null,
      sailingExperienceYears: null,
      vesselTypes: [],
      tradingAreas: [],
      shoreCareerPreference: false,
      availability: null,
      skills: ['Mentoring'],
      contactVisibility: 'members',
      onboardingCompletedAt: '2026-09-01T00:00:00.000Z',
    })
    const formData = validForm()
    formData.set('fullName', 'Mentor Example')
    formData.set('slug', 'mentor-example')
    formData.set('headline', 'Maritime Mentor')
    formData.set('summary', 'Experienced maritime mentor supporting safer professional development.')
    formData.set('skills', 'Mentoring')
    formData.set('currentCompany', 'New Shipping Co')

    await expect(updateProfile({}, formData)).rejects.toThrow('NEXT_REDIRECT:/profile')

    expect(mockedUpdateProfile).toHaveBeenCalledWith(
      viewerId,
      expect.objectContaining({ profileType: 'mentor', currentCompany: 'New Shipping Co' }),
      true,
    )
  })

  it('persists company name for Shipowner organisation identities', async () => {
    mockedGetOwnProfile.mockResolvedValueOnce({
      id: viewerId,
      slug: 'shipowner-example',
      profileType: 'company',
      identityRoot: 'organisation',
      primaryIdentity: 'Shipowner',
      fullName: 'Aditya Pratap Singh',
      avatarPath: null,
      location: 'Lucknow',
      headline: 'Shipowner',
      summary: 'Maritime business owner and industry professional.',
      rank: null,
      currentCompany: 'Old Company',
      currentVessel: null,
      sailingExperienceYears: null,
      vesselTypes: [],
      tradingAreas: [],
      shoreCareerPreference: false,
      availability: null,
      skills: ['Shipping'],
      contactVisibility: 'public',
      onboardingCompletedAt: '2026-09-01T00:00:00.000Z',
    })
    const formData = validForm()
    formData.set('fullName', 'Aditya Pratap Singh')
    formData.set('slug', 'shipowner-example')
    formData.set('location', 'Lucknow')
    formData.set('headline', 'Shipowner')
    formData.set('summary', 'Maritime business owner and industry professional.')
    formData.set('skills', 'Shipping')
    formData.set('contactVisibility', 'public')
    formData.set('currentCompany', 'Beaufort Marine Services')

    await expect(updateProfile({}, formData)).rejects.toThrow('NEXT_REDIRECT:/profile')

    expect(mockedUpdateProfile).toHaveBeenCalledWith(
      viewerId,
      expect.objectContaining({
        profileType: 'company',
        currentCompany: 'Beaufort Marine Services',
      }),
      true,
    )
  })

  it('returns the username collision message', async () => {
    mockedUpdateProfile.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: '23505' }))

    const result = await updateProfile({}, validForm())

    expect(result.fieldErrors?.slug).toEqual(['That username is already in use.'])
  })
})
