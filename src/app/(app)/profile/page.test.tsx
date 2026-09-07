import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import OwnProfilePage from './page'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
}))

vi.mock('@/features/profiles/queries', () => ({
  getOwnProfile: vi.fn(async () => ({
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'captain-example',
    profileType: 'seafarer',
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
    contactVisibility: 'members',
    onboardingCompletedAt: '2026-09-01T00:00:00.000Z',
  })),
}))

vi.mock('@/features/profiles/components/profile-header', () => ({
  ProfileHeader: () => <div>Profile header</div>,
}))
vi.mock('@/features/profiles/components/profile-about', () => ({
  ProfileAbout: () => <div>Profile about</div>,
}))
vi.mock('@/features/profiles/components/maritime-profile-card', () => ({
  MaritimeProfileCard: () => <div>Maritime profile</div>,
}))

describe('My Profile page', () => {
  it('provides an Edit all link for the signed-in owner', async () => {
    render(await OwnProfilePage())

    const editLink = screen.getByRole('link', { name: /edit all/i })
    expect(editLink).toHaveAttribute('href', '/profile/edit')
  })
})
