import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PublicProfile } from '../types'
import { ProfilePassportOverview } from './profile-passport-overview'
import { ProfilePassportToolbar } from './profile-passport-toolbar'

const profile = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'captain-a',
  profileType: 'seafarer',
  identityRoot: 'professional',
  primaryIdentity: 'Master Mariner',
  primaryIdentityFamily: 'Sea-going professional',
  secondaryIdentities: ['Tanker professional'],
  fullName: 'Captain A',
  avatarPath: 'profiles/a/avatar.webp',
  avatarUrl: null,
  coverPath: 'profiles/a/cover.webp',
  coverUrl: null,
  location: 'Mumbai, India',
  headline: 'Master Mariner | Oil & Chemical Tankers',
  summary: 'Master Mariner with international tanker command experience.',
  rank: 'Master',
  currentCompany: 'Example Shipping',
  currentVessel: 'MT Example',
  sailingExperienceYears: 18,
  vesselTypes: ['Oil Tanker', 'Chemical Tanker'],
  tradingAreas: ['Worldwide'],
  shoreCareerPreference: true,
  availability: 'ASHORE',
  skills: ['SIRE 2.0', 'Leadership'],
} satisfies PublicProfile

afterEach(() => cleanup())

describe('Maritime Passport overview', () => {
  it('renders a recruiter-scannable maritime snapshot from stored profile fields', () => {
    render(<ProfilePassportOverview profile={profile} showReadiness />)

    expect(screen.getByRole('heading', { name: 'Maritime Passport' })).toBeInTheDocument()
    expect(screen.getByText('Profile readiness')).toBeInTheDocument()
    expect(screen.getByText('18 years')).toBeInTheDocument()
    expect(screen.getByText('Oil Tanker')).toBeInTheDocument()
    expect(screen.getByText('Chemical Tanker')).toBeInTheDocument()
    expect(screen.getByText('Worldwide')).toBeInTheDocument()
    expect(screen.getByText('Interested in shore opportunities')).toBeInTheDocument()
  })

  it('keeps owner-only profile actions outside the public overview', () => {
    render(<ProfilePassportToolbar slug={profile.slug} />)

    expect(screen.getByRole('link', { name: /view public profile/i })).toHaveAttribute('href', '/people/captain-a')
    expect(screen.getByRole('button', { name: /share profile/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /download cv/i })).toHaveAttribute('href', '/api/profile/cv')
  })

  it('does not show readiness scoring on a public presentation', () => {
    render(<ProfilePassportOverview profile={profile} />)

    expect(screen.queryByText('Profile readiness')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Maritime Passport' })).toBeInTheDocument()
  })
})
