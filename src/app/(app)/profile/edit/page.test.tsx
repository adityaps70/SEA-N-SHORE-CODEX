import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getOwnProfile } from '@/features/profiles/queries'
import EditProfilePage from './page'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
}))

vi.mock('@/features/profiles/queries', () => ({
  getOwnProfile: vi.fn(),
}))

vi.mock('@/features/profiles/components/profile-edit-form', () => ({
  ProfileEditForm: ({ profile }: { profile: { fullName: string } }) => <div>Edit form for {profile.fullName}</div>,
}))

const mockedGetOwnProfile = vi.mocked(getOwnProfile)

const profile = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'captain-example',
  profileType: 'seafarer' as const,
  fullName: 'Captain Example',
  avatarPath: null,
  location: 'Mumbai',
  headline: 'Master Mariner',
  summary: 'Experienced maritime professional.',
  rank: 'Master',
  currentCompany: 'Example Shipping',
  currentVessel: 'MV Example',
  sailingExperienceYears: 18,
  vesselTypes: ['Oil Tanker'],
  tradingAreas: ['Worldwide'],
  shoreCareerPreference: false,
  availability: 'Open to mentoring',
  skills: ['Navigation'],
  contactVisibility: 'members' as const,
  onboardingCompletedAt: '2026-09-01T00:00:00.000Z',
}

describe('Edit Profile page', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads the signed-in owner profile into the edit form', async () => {
    mockedGetOwnProfile.mockResolvedValueOnce(profile)

    render(await EditProfilePage())

    expect(screen.getByRole('heading', { name: /edit profile/i })).toBeInTheDocument()
    expect(screen.getByText('Edit form for Captain Example')).toBeInTheDocument()
  })

  it('redirects to onboarding when no completed profile is available', async () => {
    mockedGetOwnProfile.mockResolvedValueOnce(null)

    await expect(EditProfilePage()).rejects.toThrow('NEXT_REDIRECT:/onboarding')
  })
})
