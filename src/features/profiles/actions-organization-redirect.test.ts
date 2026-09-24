import { beforeEach, describe, expect, it, vi } from 'vitest'
import { completeActivationWithAurora } from './onboarding-service'
import { completeActivation } from './actions'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
}))
vi.mock('@/features/auth/aws-queries', () => ({
  requireAwsUser: vi.fn(async () => ({
    id: '11111111-1111-4111-8111-111111111111',
    cognitoSub: 'activation-sub',
    email: 'viewer@example.com',
  })),
}))
vi.mock('./onboarding-service', () => ({
  completeActivationWithAurora: vi.fn(async () => true),
  completeOnboardingWithAurora: vi.fn(async () => true),
}))
vi.mock('./profile-edit-service', () => ({ updateProfileWithAurora: vi.fn(async () => true) }))
vi.mock('./aws-queries', () => ({ getAwsOwnProfile: vi.fn(async () => null) }))

function activationForm(persona: 'seafarer' | 'recruiter_hr' = 'seafarer') {
  const form = new FormData()
  form.set('persona', persona)
  form.set('profileIntents', JSON.stringify(persona === 'recruiter_hr' ? ['hire', 'network'] : ['find_jobs', 'network']))
  form.set('fullName', 'Asha Singh')
  form.set('slug', 'asha-singh')
  form.set('location', 'Mumbai')
  form.set('currentCompany', 'Oceanic Shipping')
  form.set('rank', persona === 'seafarer' ? 'Chief Engineer' : '')
  form.set('headline', persona === 'recruiter_hr' ? 'Crewing Manager' : '')
  form.set('contactVisibility', 'members')
  return form
}

describe('persona onboarding continuation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('routes completed persona onboarding to Home instead of treating organization as a competing account identity', async () => {
    await expect(completeActivation({}, activationForm('seafarer'))).rejects.toThrow('NEXT_REDIRECT:/home')
    expect(vi.mocked(completeActivationWithAurora)).toHaveBeenCalledTimes(1)
  })

  it('keeps recruiter persona activation on Home; organization setup remains a separate workspace flow', async () => {
    await expect(completeActivation({}, activationForm('recruiter_hr'))).rejects.toThrow('NEXT_REDIRECT:/home')
    expect(vi.mocked(completeActivationWithAurora)).toHaveBeenCalledTimes(1)
  })

  it('rejects the retired organisation onboarding shape instead of redirecting into company setup', async () => {
    const legacy = new FormData()
    legacy.set('identityRoot', 'organisation')
    legacy.set('primaryIdentity', 'Shipowner')
    legacy.set('primaryIdentityFamily', 'Custom identity')
    legacy.set('fullName', 'Oceanic Marine Pvt Ltd')
    legacy.set('slug', 'oceanic-marine')
    legacy.set('location', 'Mumbai')
    legacy.set('headline', 'Shipowner')
    legacy.set('contactVisibility', 'members')

    const result = await completeActivation({}, legacy)

    expect(result.fieldErrors?.persona?.[0]).toMatch(/best describes you/i)
    expect(vi.mocked(completeActivationWithAurora)).not.toHaveBeenCalled()
  })
})
