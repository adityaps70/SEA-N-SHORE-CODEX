import { beforeEach, describe, expect, it, vi } from 'vitest'

const moderationMocks = vi.hoisted(() => ({
  flagContentAutomatically: vi.fn(async () => undefined),
}))
const usernameMocks = vi.hoisted(() => ({
  check: vi.fn(async (_profileId: string, username: string) => ({ username, available: true, current: false })),
  suggest: vi.fn(async () => 'asha.singh'),
  removeDgProfile: vi.fn(async () => false),
}))
const organizationMocks = vi.hoisted(() => ({
  getListableOrganization: vi.fn(async (): Promise<unknown> => null),
}))
import { requireAwsUser } from '@/features/auth/aws-queries'
import { getAwsOwnProfile } from './aws-queries'
import { completeActivationWithAurora, completeOnboardingWithAurora } from './onboarding-service'
import { updateProfileWithAurora } from './profile-edit-service'
import { completeActivation, completeOnboarding, updateProfile } from './actions'

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
  completeActivationWithAurora: vi.fn(async () => true),
}))
vi.mock('./profile-edit-service', () => ({
  updateProfileWithAurora: vi.fn(async () => true),
}))
vi.mock('./username-availability', () => ({
  checkUsernameAvailabilityFromAurora: usernameMocks.check,
  suggestAvailableUsernameFromAurora: usernameMocks.suggest,
}))
vi.mock('./organization-link-repository', () => ({
  organizationLinkRepository: { getListableOrganization: organizationMocks.getListableOrganization },
}))
vi.mock('./profile-document-service', () => ({
  removeDgProfileDocumentForProfile: usernameMocks.removeDgProfile,
}))

const viewerId = '11111111-1111-4111-8111-111111111111'
const mockedRequireAwsUser = vi.mocked(requireAwsUser)
const mockedGetOwnProfile = vi.mocked(getAwsOwnProfile)
const mockedCompleteOnboarding = vi.mocked(completeOnboardingWithAurora)
const mockedCompleteActivation = vi.mocked(completeActivationWithAurora)
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
  return formData
}

function validActivationForm() {
  const formData = new FormData()
  formData.set('persona', 'seafarer')
  formData.set('profileIntents', JSON.stringify(['find_jobs', 'network']))
  formData.set('fullName', 'Asha Singh')
  formData.set('slug', 'asha-singh')
  formData.set('location', 'Mumbai')
  formData.set('currentCompany', 'Oceanic Shipping')
  formData.set('rank', 'Chief Engineer')
  formData.set('headline', '')
  formData.set('contactVisibility', 'members')
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

    expect(result.fieldErrors?.slug).toEqual(['That username is already in use. Choose a different username and try again.'])
  })

  it('preserves generic safe error copy for unavailable or failed onboarding', async () => {
    mockedCompleteOnboarding.mockRejectedValueOnce(new Error('onboarding_unavailable'))

    const result = await completeOnboarding({}, validForm())

    expect(result.error).toBe('We could not save your profile. Your entries are still here; please try again.')
  })
})

describe('lightweight activation error handling', () => {
  beforeEach(() => vi.clearAllMocks())

  it('turns an authentication failure into a visible corrective message and preserves entered values', async () => {
    mockedRequireAwsUser.mockRejectedValueOnce(new Error('Authentication required.'))
    const formData = validActivationForm()

    const result = await completeActivation({}, formData)

    expect(result.error).toMatch(/sign in again/i)
    expect(result.values).toMatchObject({
      fullName: 'Asha Singh',
      slug: 'asha-singh',
      location: 'Mumbai',
      currentCompany: 'Oceanic Shipping',
    })
    expect(mockedCompleteActivation).not.toHaveBeenCalled()
  })

  it('never blocks activation on a username someone claimed at the same moment: it picks another and finishes', async () => {
    // Intentional behaviour change (owner request): a duplicate during first-time activation is resolved automatically.
    mockedCompleteActivation.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: '23505' }))
    usernameMocks.suggest.mockResolvedValueOnce('asha.singh27')

    await expect(completeActivation({}, validActivationForm())).rejects.toThrow('NEXT_REDIRECT:/home')

    expect(mockedCompleteActivation).toHaveBeenCalledTimes(2)
    expect(mockedCompleteActivation.mock.calls[1]?.[1]).toMatchObject({ slug: 'asha.singh27' })
    expect(mockedCompleteActivation.mock.calls[1]?.[2]).toEqual({ usernameAutoGenerated: true })
  })
})

describe('first-time activation usernames', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usernameMocks.check.mockImplementation(async (_profileId: string, username: string) => ({ username, available: true, current: false }))
    usernameMocks.suggest.mockResolvedValue('asha.singh')
  })

  it('keeps a valid, available username the member typed and does not mark it as generated', async () => {
    const form = validActivationForm()
    form.set('usernameSuggestion', 'asha.singh')

    await expect(completeActivation({}, form)).rejects.toThrow('NEXT_REDIRECT:/home')

    expect(mockedCompleteActivation).toHaveBeenCalledWith(viewerId, expect.objectContaining({ slug: 'asha-singh' }), { usernameAutoGenerated: false })
    expect(usernameMocks.suggest).not.toHaveBeenCalled()
  })

  it('marks the kept suggestion as generated so the first later change is free', async () => {
    const form = validActivationForm()
    form.set('slug', 'asha.singh')
    form.set('usernameSuggestion', 'asha.singh')

    await expect(completeActivation({}, form)).rejects.toThrow('NEXT_REDIRECT:/home')

    expect(mockedCompleteActivation).toHaveBeenCalledWith(viewerId, expect.objectContaining({ slug: 'asha.singh' }), { usernameAutoGenerated: true })
  })

  it.each([
    ['an empty username', ''],
    ['a handle with invalid characters', 'capt saurabh!'],
    ['a handle with consecutive dots', 'capt..saurabh'],
    ['a reserved username', 'admin'],
    ['a too-short username', 'ab'],
  ])('replaces %s with a generated handle instead of showing an error', async (_label, slug) => {
    const form = validActivationForm()
    form.set('slug', slug)

    await expect(completeActivation({}, form)).rejects.toThrow('NEXT_REDIRECT:/home')

    expect(usernameMocks.suggest).toHaveBeenCalledWith(viewerId, { fullName: 'Asha Singh', email: 'viewer@example.com' })
    expect(mockedCompleteActivation).toHaveBeenCalledWith(viewerId, expect.objectContaining({ slug: 'asha.singh' }), { usernameAutoGenerated: true })
  })

  it('replaces a username that is already taken', async () => {
    usernameMocks.check.mockResolvedValueOnce({ username: 'asha-singh', available: false, current: false })

    await expect(completeActivation({}, validActivationForm())).rejects.toThrow('NEXT_REDIRECT:/home')

    expect(mockedCompleteActivation).toHaveBeenCalledWith(viewerId, expect.objectContaining({ slug: 'asha.singh' }), { usernameAutoGenerated: true })
  })

  it('discards an uploaded DG profile when the member finishes as a non-seafarer', async () => {
    const form = validActivationForm()
    form.set('persona', 'shore_professional')
    form.set('headline', 'Marine Superintendent')

    await expect(completeActivation({}, form)).rejects.toThrow('NEXT_REDIRECT:/home')

    expect(usernameMocks.removeDgProfile).toHaveBeenCalledWith(viewerId)
  })

  it('keeps the DG profile for seafarers', async () => {
    await expect(completeActivation({}, validActivationForm())).rejects.toThrow('NEXT_REDIRECT:/home')

    expect(usernameMocks.removeDgProfile).not.toHaveBeenCalled()
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
      { currentCompanySubmitted: true, rankSubmitted: true },
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
      { currentCompanySubmitted: true, rankSubmitted: true },
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
      { currentCompanySubmitted: true, rankSubmitted: true },
    )
  })

  it('returns the username collision message', async () => {
    mockedUpdateProfile.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: '23505' }))

    const result = await updateProfile({}, validForm())

    expect(result.fieldErrors?.slug).toEqual(['That username is already in use.'])
  })
})

describe('current organization link', () => {
  const organizationId = '44444444-4444-4444-8444-444444444444'

  beforeEach(() => {
    vi.clearAllMocks()
    organizationMocks.getListableOrganization.mockResolvedValue(null)
  })

  it('stores the listed organization name and id when a member picks it', async () => {
    organizationMocks.getListableOrganization.mockResolvedValueOnce({
      id: organizationId,
      slug: 'oceanic-ship-management',
      name: 'Oceanic Ship Management',
      logoUrl: null,
      verified: true,
    })
    const formData = validForm()
    formData.set('currentCompany', 'oceanic ship')
    formData.set('currentCompanyId', organizationId)

    await expect(updateProfile({}, formData)).rejects.toThrow('NEXT_REDIRECT:/profile')

    expect(organizationMocks.getListableOrganization).toHaveBeenCalledWith(organizationId)
    expect(mockedUpdateProfile).toHaveBeenCalledWith(
      viewerId,
      expect.objectContaining({ currentCompany: 'Oceanic Ship Management', currentCompanyId: organizationId }),
      true,
      { currentCompanySubmitted: true, rankSubmitted: true },
    )
  })

  it('refuses an organization that is not listed and keeps the entries', async () => {
    const formData = validForm()
    formData.set('currentCompanyId', organizationId)

    const result = await updateProfile({}, formData)

    expect(result.fieldErrors?.currentCompany?.[0]).toContain('not listed on Sea N Shore')
    expect(result.values?.currentCompanyId).toBe(organizationId)
    expect(mockedUpdateProfile).not.toHaveBeenCalled()
  })

  it('rejects a malformed organization id without looking it up', async () => {
    const formData = validForm()
    formData.set('currentCompanyId', 'not-a-uuid')

    const result = await updateProfile({}, formData)

    expect(result.fieldErrors?.currentCompanyId?.[0]).toContain('Choose the organization again')
    expect(organizationMocks.getListableOrganization).not.toHaveBeenCalled()
  })

  it('saves a typed organization as text without a link', async () => {
    await expect(updateProfile({}, validForm())).rejects.toThrow('NEXT_REDIRECT:/profile')

    expect(organizationMocks.getListableOrganization).not.toHaveBeenCalled()
    expect(mockedUpdateProfile).toHaveBeenCalledWith(
      viewerId,
      expect.objectContaining({ currentCompany: 'Example Shipping', currentCompanyId: undefined }),
      true,
      { currentCompanySubmitted: true, rankSubmitted: true },
    )
  })

  it('links the organization chosen during onboarding', async () => {
    organizationMocks.getListableOrganization.mockResolvedValueOnce({
      id: organizationId,
      slug: 'oceanic-shipping',
      name: 'Oceanic Shipping',
      logoUrl: null,
      verified: false,
    })
    const formData = validActivationForm()
    formData.set('currentCompanyId', organizationId)

    await expect(completeActivation({}, formData)).rejects.toThrow('NEXT_REDIRECT:/home')

    expect(mockedCompleteActivation).toHaveBeenCalledWith(
      viewerId,
      expect.objectContaining({ currentCompany: 'Oceanic Shipping', currentCompanyId: organizationId }),
      expect.anything(),
    )
  })

  it('explains when the organization check itself fails', async () => {
    organizationMocks.getListableOrganization.mockRejectedValueOnce(new Error('timeout'))
    const formData = validActivationForm()
    formData.set('currentCompanyId', organizationId)

    const result = await completeActivation({}, formData)

    expect(result.error).toBe('We could not check the organization you chose. Your entries are still here; please try again.')
    expect(mockedCompleteActivation).not.toHaveBeenCalled()
  })
})
