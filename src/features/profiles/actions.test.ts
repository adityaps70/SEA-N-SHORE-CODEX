import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { completeOnboardingWithAurora } from './onboarding-service'
import { completeOnboarding } from './actions'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
}))
vi.mock('@/features/auth/aws-queries', () => ({
  requireAwsUser: vi.fn(async () => ({
    id: '11111111-1111-4111-8111-111111111111',
    cognitoSub: 'cognito-subject-not-an-app-id',
    email: 'viewer@example.com',
  })),
}))
vi.mock('./onboarding-service', () => ({
  completeOnboardingWithAurora: vi.fn(async () => true),
}))

const viewerId = '11111111-1111-4111-8111-111111111111'
const mockedRequireAwsUser = vi.mocked(requireAwsUser)
const mockedCompleteOnboarding = vi.mocked(completeOnboardingWithAurora)

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

  it('preserves the existing slug collision message', async () => {
    mockedCompleteOnboarding.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: '23505' }))

    const result = await completeOnboarding({}, validForm())

    expect(result.fieldErrors?.slug).toEqual(['That profile address is already in use.'])
  })

  it('preserves generic safe error copy for unavailable or failed onboarding', async () => {
    mockedCompleteOnboarding.mockRejectedValueOnce(new Error('onboarding_unavailable'))

    const result = await completeOnboarding({}, validForm())

    expect(result.error).toBe('We could not save your profile. Your entries are still here; please try again.')
  })
})
