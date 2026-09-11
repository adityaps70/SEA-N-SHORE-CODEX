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

function activationForm(identityRoot: 'professional' | 'organisation') {
  const form = new FormData()
  form.set('identityRoot', identityRoot)
  form.set('primaryIdentity', identityRoot === 'organisation' ? 'Shipowner' : 'Chief Engineer')
  form.set('primaryIdentityFamily', 'Custom identity')
  form.set('secondaryIdentities', '[]')
  form.set('fullName', identityRoot === 'organisation' ? 'Oceanic Marine Pvt Ltd' : 'Asha Singh')
  form.set('slug', identityRoot === 'organisation' ? 'oceanic-marine' : 'asha-singh')
  form.set('location', 'Mumbai')
  form.set('headline', identityRoot === 'organisation' ? 'Shipowner' : 'Chief Engineer')
  form.set('contactVisibility', 'members')
  return form
}

describe('organization onboarding continuation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('routes Organisation activation directly into organization verification setup', async () => {
    await expect(completeActivation({}, activationForm('organisation'))).rejects.toThrow('NEXT_REDIRECT:/hiring/organization')
    expect(vi.mocked(completeActivationWithAurora)).toHaveBeenCalledTimes(1)
  })

  it('keeps Professional activation on the existing home destination', async () => {
    await expect(completeActivation({}, activationForm('professional'))).rejects.toThrow('NEXT_REDIRECT:/home')
    expect(vi.mocked(completeActivationWithAurora)).toHaveBeenCalledTimes(1)
  })
})
