import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PublicProfile } from '../types'
import { ProfileHeader } from './profile-header'

const profile: PublicProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'member-a',
  profileType: 'seafarer',
  fullName: 'Member A',
  avatarPath: null,
  location: 'Mumbai, India',
  headline: 'Chief Officer | Tankers',
  summary: 'Experienced maritime professional.',
  rank: 'Chief Officer',
  currentCompany: 'Example Shipping',
  currentVessel: 'MT Example',
  sailingExperienceYears: 12,
  vesselTypes: ['Oil Tanker'],
  tradingAreas: ['Worldwide'],
  shoreCareerPreference: true,
  availability: 'Available now',
  skills: ['SIRE 2.0'],
}

afterEach(() => cleanup())

describe('ProfileHeader', () => {
  it('renders identity and availability without relationship actions by default', () => {
    render(<ProfileHeader profile={profile} />)
    expect(screen.getByRole('heading', { name: 'Member A' })).toBeInTheDocument()
    expect(screen.getByText('Chief Officer | Tankers')).toBeInTheDocument()
    expect(screen.getByText('Available now')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument()
  })

  it('renders an optional action slot without changing profile content', () => {
    render(<ProfileHeader profile={profile} actions={<button type="button">Connect</button>} />)
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument()
    expect(screen.getByText('Mumbai, India')).toBeInTheDocument()
    expect(screen.getByText('Example Shipping')).toBeInTheDocument()
  })
})
