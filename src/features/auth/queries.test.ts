import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAwsVerifiedUser } from './aws-queries'
import { getOnboardingProfileFromAurora } from '@/features/profiles/onboarding-repository'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
}))
vi.mock('./aws-queries', () => ({ getAwsVerifiedUser: vi.fn() }))
vi.mock('@/features/profiles/onboarding-repository', () => ({
  getOnboardingProfileFromAurora: vi.fn(),
}))
vi.mock('react', () => ({ cache: <T extends (...args: never[]) => unknown>(fn: T) => fn }))

const viewerId = '11111111-1111-4111-8111-111111111111'
const mockedGetAwsVerifiedUser = vi.mocked(getAwsVerifiedUser)
const mockedGetOnboardingProfile = vi.mocked(getOnboardingProfileFromAurora)

describe('protected auth queries', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the permanent AWS profile identity and redirects when it is absent', async () => {
    mockedGetAwsVerifiedUser.mockResolvedValueOnce({ id: viewerId, cognitoSub: 'subject', email: 'viewer@example.com' })
    const { requireUser } = await import('./queries')
    await expect(requireUser()).resolves.toMatchObject({ id: viewerId, cognitoSub: 'subject' })

    mockedGetAwsVerifiedUser.mockResolvedValueOnce(null)
    await expect(requireUser()).rejects.toThrow('NEXT_REDIRECT:/auth/sign-in')
  })

  it('never permits a caller-supplied profile UUID to read another profile progress row', async () => {
    mockedGetAwsVerifiedUser.mockResolvedValue({ id: viewerId, cognitoSub: 'subject', email: null })
    const { getOwnProfileOnboardingState } = await import('./queries')

    await expect(getOwnProfileOnboardingState('22222222-2222-4222-8222-222222222222'))
      .rejects.toThrow('Unable to load profile progress.')
    expect(mockedGetOnboardingProfile).not.toHaveBeenCalled()
  })

  it('loads onboarding progress only with the authenticated permanent UUID', async () => {
    mockedGetAwsVerifiedUser.mockResolvedValue({ id: viewerId, cognitoSub: 'subject', email: null })
    mockedGetOnboardingProfile.mockResolvedValue({
      fullName: 'Captain Example',
      onboardingCompletedAt: '2026-09-05T08:00:00.000Z',
    })
    const { getOwnProfileOnboardingState } = await import('./queries')

    await expect(getOwnProfileOnboardingState(viewerId)).resolves.toBe(true)
    expect(mockedGetOnboardingProfile).toHaveBeenCalledWith(viewerId)
  })
})
