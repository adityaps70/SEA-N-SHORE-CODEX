import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { OwnProfile } from '@/features/profiles/types'
import { FeedLeftRail } from './feed-left-rail'

const profile: OwnProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'member-a',
  profileType: 'seafarer',
  fullName: 'Member A',
  avatarPath: null,
  location: 'Mumbai, India',
  headline: 'Chief Officer | Tankers',
  summary: null,
  rank: 'Chief Officer',
  currentCompany: 'Example Shipping',
  currentVessel: null,
  sailingExperienceYears: null,
  vesselTypes: [],
  tradingAreas: [],
  shoreCareerPreference: false,
  availability: null,
  skills: [],
  contactVisibility: 'members',
  onboardingCompletedAt: '2026-09-02T10:00:00.000Z',
}

describe('FeedLeftRail', () => {
  it('keeps only maritime identity and quick actions, including Saved', () => {
    render(<FeedLeftRail profile={profile} portfolioCompletion={{ experienceCount: 0, credentialCount: 0 }} />)

    expect(screen.getByText('Member A')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Quick actions' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Post update/i })).toHaveAttribute('href', '#feed-composer')
    expect(screen.getByRole('link', { name: /Ask community/i })).toHaveAttribute('href', '/community')
    expect(screen.getByRole('link', { name: /Find a job/i })).toHaveAttribute('href', '/jobs')
    expect(screen.getByRole('link', { name: /Find people/i })).toHaveAttribute('href', '/network')
    expect(screen.getByRole('link', { name: /^Saved$/i })).toHaveAttribute('href', '/saved')
    expect(screen.queryByText('Complete your profile')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Personal shortcuts' })).not.toBeInTheDocument()
  })

  it('does not show organization shortcuts when no organization data is passed', () => {
    render(<FeedLeftRail profile={profile} portfolioCompletion={{ experienceCount: 0, credentialCount: 0 }} />)
    expect(screen.queryByRole('heading', { name: 'Your organizations' })).not.toBeInTheDocument()
  })
})

afterEach(() => cleanup())

const portfolio = { experienceCount: 0, credentialCount: 0 }

describe('FeedLeftRail organization shortcuts', () => {
  it('lists each organization with logo, role, View page and Manage links', () => {
    render(
      <FeedLeftRail
        profile={profile}
        portfolioCompletion={portfolio}
        organizations={{
          memberships: [
            { id: 'c-1', slug: 'oceanic-ship-management', name: 'Oceanic Ship Management', logoUrl: '/api/company-logo/c-1', verified: true, role: 'owner' },
            { id: 'c-2', slug: 'harbour-crew', name: 'Harbour Crew Services', logoUrl: null, verified: false, role: 'member' },
          ],
          application: null,
        }}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Your organizations' })).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Your organizations' })
    const [owner, member] = within(list).getAllByRole('listitem')
    expect(within(owner!).getByText('Owner')).toBeInTheDocument()
    expect(within(owner!).getByRole('link', { name: 'View page: Oceanic Ship Management' })).toHaveAttribute('href', '/organizations/oceanic-ship-management')
    expect(within(owner!).getByRole('link', { name: 'Manage: Oceanic Ship Management' })).toHaveAttribute('href', '/organizations/oceanic-ship-management/manage')
    expect(owner!.querySelector('img')).toHaveAttribute('src', '/api/company-logo/c-1')
    expect(within(member!).getByText('Member / employee')).toBeInTheDocument()
    expect(within(member!).getByRole('link', { name: 'View page: Harbour Crew Services' })).toBeInTheDocument()
    expect(within(member!).queryByRole('link', { name: /Manage/ })).not.toBeInTheDocument()
  })

  it('shows a pending application with its status and a link to it', () => {
    render(
      <FeedLeftRail
        profile={profile}
        portfolioCompletion={portfolio}
        organizations={{
          memberships: [],
          application: {
            companyName: 'Blue Anchor Marine',
            status: 'pending',
            statusLabel: 'Sea N Shore is reviewing',
            href: '/organizations#your-organizations',
            linkLabel: 'View application',
          },
        }}
      />,
    )

    expect(screen.getByText('Blue Anchor Marine')).toBeInTheDocument()
    expect(screen.getByText('Sea N Shore is reviewing')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View application' })).toHaveAttribute('href', '/organizations#your-organizations')
    expect(screen.queryByRole('link', { name: /Create an organization page/ })).not.toBeInTheDocument()
  })

  it('offers to create an organization page when the member has none', () => {
    render(<FeedLeftRail profile={profile} portfolioCompletion={portfolio} organizations={{ memberships: [], application: null }} />)

    expect(screen.getByRole('link', { name: /Create an organization page/ })).toHaveAttribute('href', '/organizations?register=1#register-organization')
  })

  it('keeps Home usable when organizations could not be loaded', () => {
    render(<FeedLeftRail profile={profile} portfolioCompletion={portfolio} organizations={null} />)

    expect(screen.getByText(/could not load your organizations/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Organizations' })).toHaveAttribute('href', '/organizations')
  })

  it('shows at most three organizations and links to the rest', () => {
    const memberships = ['A', 'B', 'C', 'D'].map((letter) => ({
      id: `c-${letter}`, slug: `org-${letter.toLowerCase()}`, name: `Organization ${letter}`, logoUrl: null, verified: false, role: 'administrator' as const,
    }))
    render(<FeedLeftRail profile={profile} portfolioCompletion={portfolio} organizations={{ memberships, application: null }} />)

    expect(within(screen.getByRole('list', { name: 'Your organizations' })).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByRole('link', { name: 'See all 4 organizations' })).toHaveAttribute('href', '/organizations#your-organizations')
  })
})
