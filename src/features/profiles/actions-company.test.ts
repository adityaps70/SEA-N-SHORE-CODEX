import { describe, expect, it, vi } from 'vitest'
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
    cognitoSub: 'company-cognito-sub',
    email: 'company@example.com',
  })),
}))
vi.mock('./onboarding-service', () => ({
  completeOnboardingWithAurora: vi.fn(async () => true),
}))
vi.mock('./profile-edit-service', () => ({ updateProfileWithAurora: vi.fn(async () => true) }))
vi.mock('./aws-queries', () => ({ getAwsOwnProfile: vi.fn(async () => null) }))

function companyForm() {
  const formData = new FormData()
  formData.set('profileType', 'company')
  formData.set('fullName', 'Oceanic Shipping')
  formData.set('slug', 'oceanic-shipping')
  formData.set('location', 'Mumbai')
  formData.set('headline', 'Ship management and crewing')
  formData.set('summary', 'Maritime company profile for professional networking and industry participation.')
  formData.set('contactVisibility', 'members')
  formData.set('skills', 'Ship Management, Crewing')
  return formData
}

describe('company onboarding navigation', () => {
  it('lands on an existing application route after the profile is saved', async () => {
    await expect(completeOnboarding({}, companyForm())).rejects.toThrow('NEXT_REDIRECT:/home')
    expect(vi.mocked(completeOnboardingWithAurora)).toHaveBeenCalledTimes(1)
  })
})
