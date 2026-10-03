import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { OwnProfile } from '@/features/profiles/types'
import { FeedLeftRail, FeedQuickActions } from './feed-left-rail'

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

afterEach(() => cleanup())

describe('FeedLeftRail', () => {
  it('keeps only maritime identity and quick actions', () => {
    render(<FeedLeftRail profile={profile} portfolioCompletion={{ experienceCount: 0, credentialCount: 0 }} />)

    expect(screen.getByText('Member A')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Quick actions' })).toBeInTheDocument()
    expect(screen.queryByText('Complete your profile')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Personal shortcuts' })).not.toBeInTheDocument()
  })

  it('no longer shows a Your organizations box (organizations are in the profile card and the account menu)', () => {
    render(<FeedLeftRail profile={profile} portfolioCompletion={{ experienceCount: 0, credentialCount: 0 }} />)
    expect(screen.queryByRole('heading', { name: 'Your organizations' })).not.toBeInTheDocument()
    expect(screen.queryByText(/organization page/i)).not.toBeInTheDocument()
  })
})

describe('FeedQuickActions', () => {
  it('links Find a job, Find people and Saved posts, without Post update or Ask community', () => {
    render(<FeedQuickActions />)

    const nav = screen.getByRole('navigation', { name: 'Quick actions' })
    expect(within(nav).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Find a job', '/jobs'],
      ['Find people', '/network'],
      ['Saved posts', '/saved'],
    ])
    expect(screen.queryByRole('link', { name: /Post update/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Ask community/i })).not.toBeInTheDocument()
  })

  it('makes each whole row a link with hover and keyboard focus styles', () => {
    render(<FeedQuickActions />)

    for (const link of within(screen.getByRole('navigation', { name: 'Quick actions' })).getAllByRole('link')) {
      expect(link).toHaveClass('flex', 'w-full', 'min-h-10', 'cursor-pointer', 'hover:bg-ocean-50', 'focus-visible:outline')
      expect(link.querySelector('svg')).not.toBeNull()
    }
  })

  it('renders a compact row of the same links for phones and tablets', () => {
    render(<FeedQuickActions compact />)

    const nav = screen.getByRole('navigation', { name: 'Quick actions' })
    expect(nav).toHaveClass('lg:hidden')
    expect(within(nav).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/jobs', '/network', '/saved'])
  })
})
