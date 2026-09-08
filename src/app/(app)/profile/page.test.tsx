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
    availability: 'YES',
    skills: ['Navigation'],
    contactVisibility: 'members',
    onboardingCompletedAt: '2026-09-01T00:00:00.000Z',
  })),
}))

vi.mock('@/features/profiles/profile-portfolio-queries', () => ({
  getOwnProfilePortfolio: vi.fn(async () => ({ experiences: [], credentials: [] })),
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
vi.mock('@/features/profiles/components/profile-media-controls', () => ({
  ProfileMediaControls: () => <button type="button">Media control</button>,
}))
vi.mock('@/features/profiles/components/profile-career-timeline', () => ({
  ProfileCareerTimeline: () => <div>Career timeline</div>,
}))
vi.mock('@/features/profiles/components/profile-credential-wallet', () => ({
  ProfileCredentialWallet: () => <div>Certification wallet</div>,
}))

describe('My Profile page', () => {
  it('keeps profile editing inline and removes developer-style privacy controls from the page header', async () => {
    render(await OwnProfilePage())

    expect(screen.queryByRole('link', { name: /edit all/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/contact:/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view public profile/i })).toHaveAttribute('href', '/people/captain-example')
  })
})
