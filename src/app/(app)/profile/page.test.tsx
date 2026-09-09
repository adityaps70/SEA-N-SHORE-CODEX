import { readFileSync } from 'node:fs'
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
    coverPath: null,
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

vi.mock('@/features/network/queries', () => ({
  getPeopleYouMayKnow: vi.fn(async () => ([{
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'member-two',
    fullName: 'Member Two',
  }])),
}))

vi.mock('@/features/network/components/people-you-may-know', () => ({
  PeopleYouMayKnow: ({ profiles }: { profiles: Array<{ fullName: string }> }) => (
    <aside aria-label="Profile recommendations">
      <h2>People you may know</h2>
      {profiles.map((profile) => <p key={profile.fullName}>{profile.fullName}</p>)}
    </aside>
  ),
}))

vi.mock('@/features/profiles/components/profile-header', () => ({
  ProfileHeader: ({ actions }: { actions?: React.ReactNode }) => (
    <div>
      <div>Profile header</div>
      {actions}
    </div>
  ),
}))
vi.mock('@/features/profiles/components/profile-about', () => ({
  ProfileAbout: () => <section><h2>About</h2></section>,
}))
vi.mock('@/features/profiles/components/maritime-profile-card', () => ({
  MaritimeProfileCard: () => <section><h2>Maritime Experience</h2></section>,
}))
vi.mock('@/features/profiles/components/profile-media-controls', () => ({
  ProfileMediaControls: () => <button type="button">Media control</button>,
}))
vi.mock('@/features/profiles/components/profile-career-timeline', () => ({
  ProfileCareerTimeline: () => <section><h2>Experience</h2></section>,
}))
vi.mock('@/features/profiles/components/profile-credential-wallet', () => ({
  ProfileCredentialWallet: () => <section><h2>Licences & Credentials</h2></section>,
}))
vi.mock('@/features/profiles/components/profile-passport-toolbar', () => ({
  ProfilePassportToolbar: ({ slug }: { slug: string }) => <a href={`/people/${slug}`}>View public profile</a>,
}))

describe('My Profile page', () => {
  it('keeps the essential editable profile sections and adds a reusable People you may know rail', async () => {
    render(await OwnProfilePage())

    expect(screen.getByText('Profile header')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view public profile/i })).toHaveAttribute('href', '/people/captain-example')
    expect(screen.getByRole('heading', { name: 'About' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Maritime Experience' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Experience' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Licences & Credentials' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'People you may know' })).toBeInTheDocument()
    expect(screen.getByText('Member Two')).toBeInTheDocument()

    expect(screen.queryByText('Professional identity')).not.toBeInTheDocument()
    expect(screen.queryByText('My Maritime Passport')).not.toBeInTheDocument()
    expect(screen.queryByText('Sea N Shore professional identity')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Posts & activity' })).not.toBeInTheDocument()
  })

  it('uses a desktop content-plus-rail layout and does not load feed activity', () => {
    const source = readFileSync('src/app/(app)/profile/page.tsx', 'utf8')
    expect(source).toContain('lg:grid-cols-[minmax(0,1fr)_300px]')
    expect(source).toContain('lg:sticky lg:top-24')
    expect(source).not.toContain('getPostsByAuthor')
    expect(source).not.toContain('ProfilePostsSection')
  })
})
