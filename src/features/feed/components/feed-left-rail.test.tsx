import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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
    render(<FeedLeftRail profile={profile} />)

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
})
